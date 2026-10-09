use super::{database::Database, manifest::valid_id};
use crate::model::AppResult;
use base64::{engine::general_purpose::STANDARD, Engine};
use cap_std::{
    ambient_authority,
    fs::{Dir, File, OpenOptions},
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    io::{Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
};

const BLOCK: usize = 32 * 1024;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Grant {
    pub id: String,
    pub path: String,
    pub writable: bool,
}
struct Root {
    dir: Dir,
    writable: bool,
}
struct Handle {
    plugin: String,
    generation: u64,
    root: String,
    writable: bool,
    file: File,
}
#[derive(Default)]
struct State {
    roots: BTreeMap<(String, String), Root>,
    handles: BTreeMap<u64, Handle>,
    serial: u64,
}
pub struct Files {
    data: PathBuf,
    database: Arc<Database>,
    state: Mutex<State>,
}
impl Files {
    pub fn new(data: PathBuf, database: Arc<Database>) -> Self {
        Self {
            data,
            database,
            state: Default::default(),
        }
    }
    pub fn grants(&self, plugin: &str) -> AppResult<Vec<Grant>> {
        Ok(self
            .database
            .grants(plugin)?
            .into_iter()
            .map(|(id, path, writable)| Grant { id, path, writable })
            .collect())
    }
    pub fn data_directory(&self, plugin: &str) -> AppResult<PathBuf> {
        if !valid_id(plugin) {
            return Err("插件 ID 无效".into());
        }
        let path = self.data.join(plugin);
        std::fs::create_dir_all(&self.data).map_err(|e| e.to_string())?;
        if super::manifest::is_link(
            &std::fs::symlink_metadata(&self.data).map_err(|e| e.to_string())?,
        ) {
            return Err("数据根目录不允许链接".into());
        }
        let root =
            Dir::open_ambient_dir(&self.data, ambient_authority()).map_err(|e| e.to_string())?;
        if let Ok(meta) = std::fs::symlink_metadata(&path) {
            if super::manifest::is_link(&meta) {
                return Err("专属数据目录不允许链接".into());
            }
        }
        root.create_dir_all(plugin).map_err(|e| e.to_string())?;
        root.open_dir(plugin).map_err(|e| e.to_string())?;
        Ok(path)
    }
    pub fn grant(&self, plugin: &str, path: PathBuf, writable: bool) -> AppResult<Grant> {
        if !valid_id(plugin) {
            return Err("插件 ID 无效".into());
        }
        if self.grants(plugin)?.len() >= 32 {
            return Err("每个插件最多授权 32 个外部目录".into());
        }
        let path = path.canonicalize().map_err(|e| e.to_string())?;
        let dir = Dir::open_ambient_dir(&path, ambient_authority()).map_err(|e| e.to_string())?;
        let id = format!("dir-{:016x}", fastrand::u64(..));
        let grant = Grant {
            id: id.clone(),
            path: path.to_string_lossy().into_owned(),
            writable,
        };
        self.database.grant(plugin, &id, &grant.path, writable)?;
        self.state
            .lock()
            .map_err(|_| "插件文件管理器不可用")?
            .roots
            .insert((plugin.into(), id), Root { dir, writable });
        Ok(grant)
    }
    pub fn revoke(&self, plugin: &str, root: Option<&str>) -> AppResult<()> {
        let mut state = self.state.lock().map_err(|_| "插件文件管理器不可用")?;
        self.database.revoke(plugin, root)?;
        state
            .handles
            .retain(|_, h| h.plugin != plugin || root.is_some_and(|r| h.root != r));
        state
            .roots
            .retain(|(p, r), _| p != plugin || root.is_some_and(|id| id != r));
        Ok(())
    }
    pub fn close_instance(self: &Arc<Self>, plugin: &str, generation: u64) {
        if let Ok(mut state) = self.state.try_lock() {
            state
                .handles
                .retain(|_, h| h.plugin != plugin || h.generation != generation);
        } else {
            let files = self.clone();
            let plugin = plugin.to_string();
            tauri::async_runtime::spawn_blocking(move || {
                if let Ok(mut state) = files.state.lock() {
                    state
                        .handles
                        .retain(|_, h| h.plugin != plugin || h.generation != generation);
                }
            });
        }
    }
    pub fn clear_data(&self, plugin: &str) -> AppResult<()> {
        if !valid_id(plugin) {
            return Err("插件 ID 无效".into());
        }
        let path = self.data.join(plugin);
        if !path.exists() {
            return Ok(());
        }
        let root =
            Dir::open_ambient_dir(&self.data, ambient_authority()).map_err(|e| e.to_string())?;
        root.remove_dir_all(plugin).map_err(|e| e.to_string())
    }
    pub fn call(
        &self,
        plugin: &str,
        generation: u64,
        operation: &str,
        args: &Value,
        active: &std::sync::atomic::AtomicBool,
    ) -> AppResult<Value> {
        let mut state = self.state.lock().map_err(|_| "插件文件管理器不可用")?;
        if !active.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("插件加载代次已失效".into());
        }
        if matches!(
            operation,
            "files.read" | "files.write" | "files.truncate" | "files.close"
        ) {
            let id = args
                .get("handle")
                .and_then(Value::as_u64)
                .ok_or("缺少文件句柄")?;
            let h = state
                .handles
                .get_mut(&id)
                .filter(|h| h.plugin == plugin && h.generation == generation)
                .ok_or("文件句柄已失效")?;
            let value = match operation {
                "files.read" => {
                    let length = args
                        .get("length")
                        .and_then(Value::as_u64)
                        .unwrap_or(BLOCK as u64);
                    if length > BLOCK as u64 {
                        return Err("读取块超过 32KiB".into());
                    }
                    let offset = args
                        .get("offset")
                        .and_then(Value::as_u64)
                        .ok_or("缺少读取偏移")?;
                    h.file
                        .seek(SeekFrom::Start(offset))
                        .map_err(|e| e.to_string())?;
                    let mut data = vec![0; length as usize];
                    let count = h.file.read(&mut data).map_err(|e| e.to_string())?;
                    data.truncate(count);
                    json!({"data":STANDARD.encode(data),"bytes":count})
                }
                "files.write" => {
                    if !h.writable {
                        return Err("目录只读".into());
                    }
                    let data = STANDARD
                        .decode(text(args, "data")?)
                        .map_err(|_| "文件数据必须为 base64")?;
                    if data.len() > BLOCK {
                        return Err("写入块超过 32KiB".into());
                    }
                    let offset = args
                        .get("offset")
                        .and_then(Value::as_u64)
                        .ok_or("缺少写入偏移")?;
                    h.file
                        .seek(SeekFrom::Start(offset))
                        .map_err(|e| e.to_string())?;
                    h.file.write_all(&data).map_err(|e| e.to_string())?;
                    json!({"bytes":data.len()})
                }
                "files.truncate" => {
                    if !h.writable {
                        return Err("目录只读".into());
                    }
                    h.file
                        .set_len(
                            args.get("length")
                                .and_then(Value::as_u64)
                                .ok_or("缺少长度")?,
                        )
                        .map_err(|e| e.to_string())?;
                    Value::Null
                }
                _ => Value::Null,
            };
            if operation == "files.close" {
                state.handles.remove(&id);
            }
            return Ok(value);
        }
        let root_id = text(args, "root")?;
        let key = (plugin.to_string(), root_id.to_string());
        if !state.roots.contains_key(&key) {
            let (path, writable) = if root_id == "data" {
                let path = self.data_directory(plugin)?;
                (path, true)
            } else {
                let grant = self
                    .grants(plugin)?
                    .into_iter()
                    .find(|g| g.id == root_id)
                    .ok_or("目录未授权或授权已撤销")?;
                (PathBuf::from(grant.path), grant.writable)
            };
            let dir =
                Dir::open_ambient_dir(path, ambient_authority()).map_err(|e| e.to_string())?;
            state.roots.insert(key.clone(), Root { dir, writable });
        }
        let root = &state.roots[&key];
        let path = args.get("path").and_then(Value::as_str).unwrap_or("");
        relative(path)?;
        let file_path = if path.is_empty() { "." } else { path };
        let mutating = matches!(operation, "files.mkdir" | "files.rename" | "files.remove")
            || (operation == "files.open"
                && args.get("mode").and_then(Value::as_str).unwrap_or("read") != "read");
        if mutating && !root.writable {
            return Err("目录只读".into());
        }
        if matches!(operation, "files.remove" | "files.rename" | "files.open") && path.is_empty() {
            return Err("不允许操作目录根本身".into());
        }
        match operation {
            "files.stat" => {
                let m = root.dir.metadata(file_path).map_err(|e| e.to_string())?;
                Ok(json!({"isDirectory":m.is_dir(),"size":m.len()}))
            }
            "files.list" => {
                let offset = args.get("offset").and_then(Value::as_u64).unwrap_or(0);
                if offset > usize::MAX as u64 {
                    return Err("目录偏移无效".into());
                }
                let mut entries = Vec::new();
                let mut more = false;
                let mut bytes = 0;
                for entry in root
                    .dir
                    .read_dir(file_path)
                    .map_err(|e| e.to_string())?
                    .skip(offset as usize)
                    .take(129)
                {
                    let entry = entry.map_err(|e| e.to_string())?;
                    if entries.len() == 128 {
                        more = true;
                        break;
                    }
                    let name = entry
                        .file_name()
                        .into_string()
                        .map_err(|_| "文件名称不是 UTF-8")?;
                    let kind = entry.file_type().map_err(|e| e.to_string())?;
                    let item =
                        json!({"name":name,"isDirectory":kind.is_dir(),"isLink":kind.is_symlink()});
                    bytes += serde_json::to_vec(&item).map_err(|e| e.to_string())?.len();
                    if bytes > 60000 {
                        more = true;
                        break;
                    }
                    entries.push(item);
                }
                Ok(
                    json!({"entries":entries,"nextOffset":if more{Some(offset+entries.len() as u64)}else{None}}),
                )
            }
            "files.mkdir" => {
                if path.is_empty() {
                    return Err("缺少目录路径".into());
                }
                root.dir.create_dir_all(path).map_err(|e| e.to_string())?;
                Ok(Value::Null)
            }
            "files.rename" => {
                let to = text(args, "to")?;
                relative(to)?;
                if to.is_empty() {
                    return Err("缺少目标路径".into());
                }
                root.dir
                    .rename(path, &root.dir, to)
                    .map_err(|e| e.to_string())?;
                Ok(Value::Null)
            }
            "files.remove" => {
                if root
                    .dir
                    .symlink_metadata(path)
                    .map_err(|e| e.to_string())?
                    .is_dir()
                {
                    root.dir.remove_dir(path).map_err(|e| e.to_string())?;
                } else {
                    root.dir.remove_file(path).map_err(|e| e.to_string())?;
                }
                Ok(Value::Null)
            }
            "files.open" => {
                if state
                    .handles
                    .values()
                    .filter(|h| h.plugin == plugin && h.generation == generation)
                    .count()
                    >= 16
                {
                    return Err("每实例最多打开 16 个文件".into());
                }
                let mode = args.get("mode").and_then(Value::as_str).unwrap_or("read");
                let mut options = OpenOptions::new();
                match mode {
                    "read" => {
                        options.read(true);
                    }
                    "readWrite" => {
                        options.read(true).write(true).create(true);
                    }
                    "create" => {
                        options.read(true).write(true).create_new(true);
                    }
                    _ => return Err("未知文件打开方式".into()),
                };
                let file = state.roots[&key]
                    .dir
                    .open_with(path, &options)
                    .map_err(|e| e.to_string())?;
                state.serial = state.serial.checked_add(1).ok_or("文件句柄耗尽")?;
                let id = state.serial;
                state.handles.insert(
                    id,
                    Handle {
                        plugin: plugin.into(),
                        generation,
                        root: root_id.into(),
                        writable: mode != "read",
                        file,
                    },
                );
                Ok(json!({"handle":id}))
            }
            _ => Err("未知文件操作".into()),
        }
    }
}
fn text<'a>(args: &'a Value, key: &str) -> AppResult<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("缺少 {key}"))
}
fn relative(path: &str) -> AppResult<()> {
    if path.len() > 4096
        || path.contains(['\\', ':', '\0'])
        || Path::new(path)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
            && !path.is_empty()
    {
        return Err("文件路径必须是目录内的相对路径".into());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pagination_and_readonly_handle_revocation() {
        let tmp = tempfile::tempdir().unwrap();
        let db = Arc::new(Database::open(Path::new(":memory:")).unwrap());
        let files = Arc::new(Files::new(tmp.path().join("data"), db));
        let outside = tempfile::tempdir().unwrap();
        for i in 0..140 {
            std::fs::write(outside.path().join(format!("file-{i}")), [1, 2, 3]).unwrap();
        }
        let grant = files.grant("one", outside.path().into(), false).unwrap();
        let active = std::sync::atomic::AtomicBool::new(true);
        let call = |op, args| files.call("one", 1, op, &args, &active);
        let first = call("files.list", json!({"root":grant.id})).unwrap();
        assert_eq!(first["entries"].as_array().unwrap().len(), 128);
        let second = call(
            "files.list",
            json!({"root":grant.id,"offset":first["nextOffset"]}),
        )
        .unwrap();
        assert_eq!(second["entries"].as_array().unwrap().len(), 12);
        assert!(second["nextOffset"].is_null());
        let opened = call("files.open", json!({"root":grant.id,"path":"file-0"})).unwrap();
        let h = opened["handle"].clone();
        assert!(call("files.write", json!({"handle":h,"offset":0,"data":"AA=="})).is_err());
        files.revoke("one", Some(&grant.id)).unwrap();
        assert!(call("files.read", json!({"handle":h,"offset":0})).is_err());
        assert_eq!(
            std::fs::read(outside.path().join("file-0")).unwrap(),
            [1, 2, 3]
        );
    }
    #[cfg(windows)]
    #[test]
    fn junction_cannot_escape_data_root() {
        let tmp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret"), b"private").unwrap();
        let db = Arc::new(Database::open(Path::new(":memory:")).unwrap());
        let files = Files::new(tmp.path().join("data"), db);
        let root = files.data_directory("one").unwrap();
        let junction = root.join("escape");
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&junction)
            .arg(outside.path())
            .output()
            .unwrap();
        assert!(
            status.status.success(),
            "{}",
            String::from_utf8_lossy(&status.stderr)
        );
        let active = std::sync::atomic::AtomicBool::new(true);
        assert!(files
            .call(
                "one",
                1,
                "files.open",
                &json!({"root":"data","path":"escape/secret"}),
                &active
            )
            .is_err());
        assert!(files
            .call(
                "one",
                1,
                "files.open",
                &json!({"root":"data","path":"escape/new","mode":"create"}),
                &active
            )
            .is_err());
        std::fs::remove_dir(junction).unwrap();
        assert!(!outside.path().join("new").exists());
        assert_eq!(
            std::fs::read(outside.path().join("secret")).unwrap(),
            b"private"
        );
    }
    #[test]
    fn binary_handles_grants_and_revocation() {
        let tmp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let db = Arc::new(Database::open(Path::new(":memory:")).unwrap());
        let files = Arc::new(Files::new(tmp.path().join("data"), db.clone()));
        let active = std::sync::atomic::AtomicBool::new(true);
        let call = |op, args| files.call("one", 1, op, &args, &active);
        let h = call(
            "files.open",
            json!({"root":"data","path":"sample.bin","mode":"create"}),
        )
        .unwrap()["handle"]
            .as_u64()
            .unwrap();
        call(
            "files.write",
            json!({"handle":h,"offset":0,"data":STANDARD.encode([0,255,1])}),
        )
        .unwrap();
        assert_eq!(
            call("files.read", json!({"handle":h,"offset":0})).unwrap()["data"],
            STANDARD.encode([0, 255, 1])
        );
        assert!(files
            .call(
                "two",
                1,
                "files.read",
                &json!({"handle":h,"offset":0}),
                &active
            )
            .is_err());
        assert!(call("files.read", json!({"handle":h,"offset":0,"length":32769})).is_err());
        assert!(call("files.open", json!({"root":"data","path":"../outside"})).is_err());
        let grant = files.grant("one", outside.path().into(), false).unwrap();
        assert!(call("files.mkdir", json!({"root":grant.id,"path":"new"})).is_err());
        files.revoke("one", Some(&grant.id)).unwrap();
        assert!(call("files.list", json!({"root":grant.id})).is_err());
        assert!(outside.path().exists());
        files.close_instance("one", 1);
        assert!(call("files.read", json!({"handle":h,"offset":0})).is_err());
        active.store(false, std::sync::atomic::Ordering::SeqCst);
        assert!(call("files.list", json!({"root":"data"})).is_err());
        assert!(db.grants("one").unwrap().is_empty());
    }
}
