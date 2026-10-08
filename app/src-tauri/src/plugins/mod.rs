mod capability;
mod clipboard;
mod database;
mod install;
pub mod manifest;
#[cfg(feature = "plugin-probe")]
pub mod probe;
mod runtime;

use crate::{model::AppResult, netease::Netease, player::Player};
use capability::{Context, SongService};
use database::Database;
use manifest::Manifest;
use serde::Serialize;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Descriptor {
    pub manifest: Manifest,
    pub enabled: bool,
    pub loaded: bool,
    pub generation: u64,
    pub error: Option<String>,
}
struct Record {
    descriptor: Descriptor,
    context: Context,
    runtime: Option<Arc<tokio::sync::Mutex<runtime::Runtime>>>,
    ready: bool,
}
pub struct PluginManager {
    root: PathBuf,
    database: Arc<Database>,
    songs: Arc<SongService>,
    player: Arc<Player>,
    app: tauri::AppHandle,
    records: Mutex<BTreeMap<String, Record>>,
    operations: tokio::sync::Mutex<()>,
    engine: Mutex<Option<wasmtime::Engine>>,
    generation: AtomicU64,
    stopped: AtomicBool,
    watcher: Mutex<Option<clipboard::Shutdown>>,
    clipboard_sender: tokio::sync::watch::Sender<Vec<String>>,
}
impl PluginManager {
    pub fn new(
        app: tauri::AppHandle,
        data: &Path,
        netease: Arc<Netease>,
        player: Arc<Player>,
    ) -> AppResult<Arc<Self>> {
        let root = data.join("plugins");
        std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let (clipboard_sender, mut receiver) = tokio::sync::watch::channel(Vec::new());
        let manager = Arc::new(Self {
            root,
            database: Arc::new(Database::open(&data.join("plugins.sqlite3"))?),
            songs: Arc::new(SongService::new(netease)),
            player,
            app,
            records: Default::default(),
            operations: Default::default(),
            engine: Default::default(),
            generation: AtomicU64::new(1),
            stopped: AtomicBool::new(false),
            watcher: Default::default(),
            clipboard_sender,
        });
        // Bundled artifacts are built outside the host and copied only once.
        if !manager.database.initialized()? {
            let bundled = manager
                .app
                .path()
                .resource_dir()
                .map_err(|e| e.to_string())?
                .join("bundled-plugins");
            if bundled.is_dir() {
                for entry in std::fs::read_dir(&bundled)
                    .map_err(|e| e.to_string())?
                    .flatten()
                {
                    let Ok(manifest) = Manifest::read(&entry.path()) else {
                        continue;
                    };
                    let destination = manager.root.join(&manifest.id);
                    if destination.exists() {
                        continue;
                    }
                    let staging = manager.root.join(format!(".bundled-{}", manifest.id));
                    if staging.exists() {
                        let _ = std::fs::remove_dir_all(&staging);
                    }
                    if install::install(&entry.path(), &staging).is_ok()
                        && std::fs::rename(&staging, destination).is_err()
                    {
                        let _ = std::fs::remove_dir_all(&staging);
                    }
                }
                manager.database.mark_initialized()?;
            }
        }
        manager.discover()?;
        let weak = Arc::downgrade(&manager);
        tauri::async_runtime::spawn(async move {
            let client = match reqwest::Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(3))
                .build()
            {
                Ok(client) => client,
                Err(_) => return,
            };
            while receiver.changed().await.is_ok() {
                let urls = receiver.borrow_and_update().clone();
                let Some(manager) = weak.upgrade() else {
                    break;
                };
                if manager.stopped.load(Ordering::SeqCst) {
                    break;
                }
                for candidate in urls {
                    if !manager.has_clipboard_subscribers() {
                        break;
                    }
                    if let Ok(Ok(url)) = tokio::time::timeout(
                        Duration::from_secs(3),
                        clipboard::resolve(&candidate, &client),
                    )
                    .await
                    {
                        manager.deliver_link(&url).await;
                    }
                }
            }
        });
        Ok(manager)
    }
    fn lock(&self) -> AppResult<std::sync::MutexGuard<'_, BTreeMap<String, Record>>> {
        self.records.lock().map_err(|_| "插件注册表不可用".into())
    }
    fn context(&self, manifest: &Manifest, generation: u64) -> Context {
        Context {
            id: manifest.id.clone(),
            generation,
            permissions: manifest.permissions.iter().cloned().collect(),
            active: Arc::new(AtomicBool::new(false)),
            database: self.database.clone(),
            songs: self.songs.clone(),
            player: self.player.clone(),
            app: self.app.clone(),
            event_budget: Arc::new(Mutex::new((Instant::now(), 0))),
            requests: Arc::new(tokio::sync::Semaphore::new(16)),
        }
    }
    pub fn discover(&self) -> AppResult<()> {
        let mut records = self.lock()?;
        for entry in std::fs::read_dir(&self.root).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let id = entry.file_name().to_string_lossy().to_string();
            if !manifest::valid_id(&id) || records.contains_key(&id) {
                continue;
            }
            let meta = std::fs::symlink_metadata(entry.path()).map_err(|e| e.to_string())?;
            if manifest::is_link(&meta) || !meta.is_dir() {
                continue;
            }
            let manifest = match Manifest::read(&entry.path()) {
                Ok(manifest) if manifest.id == id => manifest,
                _ => continue,
            };
            let generation = self.generation.fetch_add(1, Ordering::SeqCst);
            let context = self.context(&manifest, generation);
            let descriptor = Descriptor {
                enabled: self.database.enabled(&id)?,
                loaded: false,
                generation,
                error: None,
                manifest,
            };
            records.insert(
                id,
                Record {
                    descriptor,
                    context,
                    runtime: None,
                    ready: false,
                },
            );
        }
        Ok(())
    }
    pub fn list(&self) -> AppResult<Vec<Descriptor>> {
        Ok(self
            .lock()?
            .values()
            .map(|r| r.descriptor.clone())
            .collect())
    }
    fn notify(&self) {
        let _ = self.app.emit("plugins-changed", ());
    }
    pub async fn startup(self: &Arc<Self>) {
        if let Ok(plugins) = self.list() {
            for plugin in plugins {
                if plugin.enabled {
                    let _ = self.action(&plugin.manifest.id, "load", false).await;
                }
            }
        }
    }
    pub async fn install(self: &Arc<Self>, source: PathBuf) -> AppResult<()> {
        let _operation = self.operations.lock().await;
        let root = self.root.clone();
        let staging = root.join(format!(
            ".staging-{}",
            self.generation.fetch_add(1, Ordering::SeqCst)
        ));
        let result: AppResult<()> = tauri::async_runtime::spawn_blocking(move || {
            let manifest = install::install(&source, &staging)?;
            let destination = root.join(&manifest.id);
            if destination.exists() {
                let _ = std::fs::remove_dir_all(&staging);
                return Err("同 ID 插件已安装，请先卸载".into());
            }
            if let Err(error) = std::fs::rename(&staging, destination) {
                let _ = std::fs::remove_dir_all(&staging);
                return Err(error.to_string());
            }
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())?;
        result?;
        self.discover()?;
        self.notify();
        Ok(())
    }
    fn get_engine(&self) -> AppResult<wasmtime::Engine> {
        let mut engine = self.engine.lock().map_err(|_| "WASM Engine 不可用")?;
        if engine.is_none() {
            let value = runtime::engine()?;
            let weak = value.weak();
            std::thread::Builder::new()
                .name("nons-plugin-epoch".into())
                .spawn(move || {
                    while let Some(engine) = weak.upgrade() {
                        engine.increment_epoch();
                        drop(engine);
                        std::thread::sleep(Duration::from_millis(10));
                    }
                })
                .map_err(|e| e.to_string())?;
            *engine = Some(value);
        }
        engine.clone().ok_or_else(|| "WASM Engine 不可用".into())
    }
    pub async fn action(
        self: &Arc<Self>,
        id: &str,
        action: &str,
        confirmed: bool,
    ) -> AppResult<()> {
        let _operation = self.operations.lock().await;
        if !manifest::valid_id(id) {
            return Err("插件 ID 无效".into());
        }
        if !self.lock()?.contains_key(id) {
            return Err("插件未安装".into());
        }
        match action {
            "enable" => {
                if !confirmed {
                    return Err("请先确认插件权限和前端信任说明".into());
                }
                self.database.enable(id, true)?;
                self.lock()?
                    .get_mut(id)
                    .ok_or("插件未安装")?
                    .descriptor
                    .enabled = true;
                self.load(id).await?;
            }
            "load" => {
                if !self.lock()?.get(id).ok_or("插件未安装")?.descriptor.enabled {
                    return Err("插件未启用".into());
                }
                self.load(id).await?;
            }
            "disable" => {
                self.database.enable(id, false)?;
                self.lock()?
                    .get_mut(id)
                    .ok_or("插件未安装")?
                    .descriptor
                    .enabled = false;
                self.unload(id).await?;
            }
            "unload" => {
                self.unload(id).await?;
            }
            "reload" => {
                self.unload(id).await?;
                if self.lock()?.get(id).ok_or("插件未安装")?.descriptor.enabled {
                    self.load(id).await?;
                }
            }
            "uninstall" => {
                self.database.enable(id, false)?;
                self.lock()?
                    .get_mut(id)
                    .ok_or("插件未安装")?
                    .descriptor
                    .enabled = false;
                self.unload(id).await?;
                std::fs::remove_dir_all(self.root.join(id)).map_err(|e| e.to_string())?;
                self.database.remove(id)?;
                self.lock()?.remove(id);
            }
            _ => return Err("未知插件操作".into()),
        }
        self.sync_watcher()?;
        self.notify();
        Ok(())
    }
    async fn load(self: &Arc<Self>, id: &str) -> AppResult<()> {
        if self.lock()?.get(id).ok_or("插件未安装")?.descriptor.loaded {
            return Ok(());
        }
        let manifest = Manifest::read(&self.root.join(id))?;
        if manifest.backend.is_some()
            && self
                .lock()?
                .values()
                .filter(|r| r.descriptor.loaded && r.runtime.is_some())
                .count()
                >= 4
        {
            return Err("同时加载的 WASM 插件最多 4 个".into());
        }
        let old = self
            .lock()?
            .get(id)
            .ok_or("插件未安装")?
            .descriptor
            .manifest
            .clone();
        if manifest.id != id
            || manifest.permissions != old.permissions
            || manifest.version != old.version
        {
            return Err("插件权限或版本已改变，请重新安装并授权".into());
        }
        let generation = self.generation.fetch_add(1, Ordering::SeqCst);
        let context = self.context(&manifest, generation);
        context.active.store(true, Ordering::SeqCst);
        let runtime = if let Some(entry) = &manifest.backend {
            match runtime::Runtime::load(
                self.get_engine()?,
                &manifest::checked_file(&self.root.join(id), entry)?,
                context.clone(),
            )
            .await
            {
                Ok(runtime) => Some(Arc::new(tokio::sync::Mutex::new(runtime))),
                Err(error) => {
                    context.active.store(false, Ordering::SeqCst);
                    self.lock()?
                        .get_mut(id)
                        .ok_or("插件未安装")?
                        .descriptor
                        .error = Some(error.clone());
                    self.notify();
                    return Err(error);
                }
            }
        } else {
            None
        };
        let mut records = self.lock()?;
        let record = records.get_mut(id).ok_or("插件未安装")?;
        record.context = context;
        record.runtime = runtime;
        record.ready = manifest.frontend.is_none();
        record.descriptor.manifest = manifest;
        record.descriptor.loaded = true;
        record.descriptor.generation = generation;
        record.descriptor.error = None;
        Ok(())
    }
    async fn unload(&self, id: &str) -> AppResult<()> {
        let runtime = {
            let mut records = self.lock()?;
            let record = records.get_mut(id).ok_or("插件未安装")?;
            record.context.active.store(false, Ordering::SeqCst);
            record.descriptor.loaded = false;
            record.ready = false;
            record.runtime.take()
        };
        self.notify();
        if let Some(runtime) = runtime {
            let _ = tokio::time::timeout(Duration::from_secs(1), async {
                runtime.lock().await.shutdown().await
            })
            .await;
        }
        Ok(())
    }
    pub fn scoped(&self, id: &str, generation: u64) -> AppResult<Context> {
        let records = self.lock()?;
        let record = records.get(id).ok_or("插件未安装")?;
        if !record.descriptor.loaded || record.descriptor.generation != generation {
            return Err("插件加载代次已失效".into());
        }
        record.context.check(None)?;
        Ok(record.context.clone())
    }
    pub async fn call(
        self: &Arc<Self>,
        id: &str,
        generation: u64,
        method: &str,
        args: &str,
    ) -> AppResult<String> {
        if method.starts_with("event:") {
            return Err("SDK 不允许发送宿主事件".into());
        }
        self.invoke(id, generation, method, args).await
    }
    async fn invoke(
        self: &Arc<Self>,
        id: &str,
        generation: u64,
        method: &str,
        args: &str,
    ) -> AppResult<String> {
        let context = self.scoped(id, generation)?;
        let _permit = context
            .requests
            .clone()
            .try_acquire_owned()
            .map_err(|_| "插件调用过于频繁")?;
        let runtime = self
            .lock()?
            .get(id)
            .and_then(|r| r.runtime.clone())
            .ok_or("插件没有 WASM Backend")?;
        let result = tokio::time::timeout(Duration::from_secs(6), async {
            let mut runtime = runtime.lock().await;
            context.check(None)?;
            let result = runtime.call(method, args).await;
            if runtime.faulted {
                if let Err(error) = &result {
                    self.fault(id, generation, error)?;
                }
            }
            result
        })
        .await
        .map_err(|_| "插件调用队列超时".to_string())
        .and_then(|r| r);
        match result {
            Ok(value) => {
                context.check(None)?;
                Ok(value)
            }
            Err(error) => Err(error),
        }
    }
    pub fn fault(self: &Arc<Self>, id: &str, generation: u64, error: &str) -> AppResult<()> {
        if let Some(record) = self
            .lock()?
            .get_mut(id)
            .filter(|r| r.descriptor.loaded && r.descriptor.generation == generation)
        {
            record.context.active.store(false, Ordering::SeqCst);
            record.descriptor.loaded = false;
            record.descriptor.error = Some(error.chars().take(512).collect());
            record.runtime = None;
            record.ready = false;
        }
        self.sync_watcher()?;
        self.notify();
        Ok(())
    }
    pub fn ready(self: &Arc<Self>, id: &str, generation: u64) -> AppResult<()> {
        self.scoped(id, generation)?.check(Some("ui"))?;
        self.lock()?.get_mut(id).ok_or("插件未安装")?.ready = true;
        self.sync_watcher()
    }
    pub fn has_clipboard_subscribers(&self) -> bool {
        self.lock().is_ok_and(|records| {
            records.values().any(|r| {
                r.descriptor.loaded
                    && r.ready
                    && r.context.permissions.contains("clipboard:music-links")
            })
        })
    }
    fn sync_watcher(self: &Arc<Self>) -> AppResult<()> {
        let mut watcher = self.watcher.lock().map_err(|_| "剪贴板监听不可用")?;
        if self.has_clipboard_subscribers() && watcher.is_none() {
            *watcher = Some(clipboard::start(self)?);
        }
        if !self.has_clipboard_subscribers() {
            if let Some(watcher) = watcher.take() {
                watcher.stop();
            }
        }
        if !self.lock()?.values().any(|record| record.runtime.is_some()) {
            *self.engine.lock().map_err(|_| "WASM Engine 不可用")? = None;
        }
        Ok(())
    }
    async fn deliver_link(self: &Arc<Self>, url: &str) {
        let targets = self
            .lock()
            .map(|records| {
                records
                    .values()
                    .filter(|r| {
                        r.descriptor.loaded
                            && r.ready
                            && r.context.permissions.contains("clipboard:music-links")
                    })
                    .map(|r| (r.context.id.clone(), r.context.generation))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for (id, generation) in targets {
            let _ = self
                .invoke(
                    &id,
                    generation,
                    "event:music-link",
                    &serde_json::json!({"url":url}).to_string(),
                )
                .await;
        }
    }
    pub fn resource(
        &self,
        request: &tauri::http::Request<Vec<u8>>,
    ) -> AppResult<(Vec<u8>, &'static str)> {
        if request.method() != tauri::http::Method::GET {
            return Err("不支持的资源请求".into());
        }
        let uri = request.uri();
        let decoded = percent_encoding::percent_decode_str(uri.path())
            .decode_utf8()
            .map_err(|_| "插件资源编码无效")?;
        let path = decoded.trim_start_matches('/');
        let mut parts = path.splitn(3, '/');
        let id = parts.next().ok_or("插件资源无效")?;
        let generation = parts
            .next()
            .and_then(|v| v.parse::<u64>().ok())
            .ok_or("资源代次无效")?;
        let relative = parts.next().ok_or("资源路径无效")?;
        let context = self.scoped(id, generation)?;
        context.check(Some("ui"))?;
        if let Some(module) = relative.strip_prefix("_host/") {
            return host_module(module);
        }
        let records = self.lock()?;
        let manifest = &records.get(id).ok_or("插件未安装")?.descriptor.manifest;
        if manifest.frontend.as_deref() != Some(relative) && !relative.starts_with("assets/") {
            return Err("资源不在公开范围".into());
        }
        let file = manifest::checked_file(&self.root.join(id), relative)?;
        if file.metadata().map_err(|e| e.to_string())?.len() > 8 * 1024 * 1024 {
            return Err("资源过大".into());
        }
        let mime = match file.extension().and_then(|e| e.to_str()) {
            Some("mjs" | "js") => "text/javascript",
            Some("css") => "text/css",
            Some("png") => "image/png",
            Some("jpg" | "jpeg") => "image/jpeg",
            Some("webp") => "image/webp",
            Some("svg") => "image/svg+xml",
            Some("woff2") => "font/woff2",
            _ => return Err("不支持的插件资源类型".into()),
        };
        use std::io::Read;
        let mut bytes = Vec::new();
        std::fs::File::open(file)
            .map_err(|e| e.to_string())?
            .take(8 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 8 * 1024 * 1024 {
            return Err("资源过大".into());
        }
        context.check(None)?;
        Ok((bytes, mime))
    }
    pub async fn account_changed(&self) {
        self.songs.clear().await;
    }
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        if let Ok(records) = self.lock() {
            for record in records.values() {
                record.context.active.store(false, Ordering::SeqCst);
            }
        }
        if let Ok(mut watcher) = self.watcher.lock() {
            if let Some(watcher) = watcher.take() {
                watcher.stop();
            }
        }
        if let Ok(mut engine) = self.engine.lock() {
            *engine = None;
        }
        self.clipboard_sender.send_replace(Vec::new());
    }
}
fn host_module(module: &str) -> AppResult<(Vec<u8>, &'static str)> {
    let (object, exports) = match module {
        "react.mjs" => ("react", "Children,Fragment,Profiler,StrictMode,Suspense,Component,PureComponent,createContext,createElement,cloneElement,isValidElement,forwardRef,memo,lazy,startTransition,useActionState,useCallback,useContext,useDebugValue,useDeferredValue,useEffect,useId,useImperativeHandle,useInsertionEffect,useLayoutEffect,useMemo,useOptimistic,useReducer,useRef,useState,useSyncExternalStore,useTransition,use,act,cache,version"),
        "jsx-runtime.mjs" => ("jsx", "Fragment,jsx,jsxs"),
        "sdk.mjs" => ("sdk", "usePluginBackend,usePluginEvent,usePluginStorage,usePluginNavigate,usePluginRoute,usePlayer,useTheme,useCoverSource,useSongPlayback,SongArtists,SongLikeButton,Button"),
        _ => return Err("未知宿主桥接模块".into()),
    };
    Ok((format!("const host=globalThis.__NONS_PLUGIN_HOST__.{object};export default host;export const {{{exports}}}=host;").into_bytes(), "text/javascript"))
}

#[tauri::command]
pub fn plugin_list(manager: State<'_, Arc<PluginManager>>) -> AppResult<Vec<Descriptor>> {
    manager.list()
}
#[tauri::command]
pub fn plugin_open_folder(manager: State<'_, Arc<PluginManager>>) -> AppResult<()> {
    manager
        .app
        .opener()
        .open_path(manager.root.to_string_lossy(), None::<&str>)
        .map_err(|error| error.to_string())
}
#[tauri::command]
pub fn plugin_discover(manager: State<'_, Arc<PluginManager>>) -> AppResult<Vec<Descriptor>> {
    manager.discover()?;
    manager.notify();
    manager.list()
}
#[tauri::command]
pub async fn plugin_install(path: String, manager: State<'_, Arc<PluginManager>>) -> AppResult<()> {
    manager.inner().install(path.into()).await
}
#[tauri::command]
pub async fn plugin_action(
    id: String,
    action: String,
    confirmed: bool,
    manager: State<'_, Arc<PluginManager>>,
) -> AppResult<()> {
    manager.inner().action(&id, &action, confirmed).await
}
#[tauri::command]
pub async fn plugin_call(
    id: String,
    generation: u64,
    method: String,
    args: String,
    manager: State<'_, Arc<PluginManager>>,
) -> AppResult<String> {
    manager.inner().call(&id, generation, &method, &args).await
}
#[tauri::command]
pub async fn plugin_host_call(
    id: String,
    generation: u64,
    operation: String,
    args: String,
    manager: State<'_, Arc<PluginManager>>,
) -> AppResult<String> {
    let context = manager.scoped(&id, generation)?;
    let _permit = context
        .requests
        .clone()
        .try_acquire_owned()
        .map_err(|_| "插件调用过于频繁")?;
    context.call(&operation, &args).await
}
#[tauri::command]
pub fn plugin_ready(
    id: String,
    generation: u64,
    manager: State<'_, Arc<PluginManager>>,
) -> AppResult<()> {
    manager.inner().ready(&id, generation)
}
#[tauri::command]
pub fn plugin_fault(
    id: String,
    generation: u64,
    error: String,
    manager: State<'_, Arc<PluginManager>>,
) -> AppResult<()> {
    manager.inner().fault(&id, generation, &error)
}

pub fn protocol(
    context: tauri::UriSchemeContext<'_, tauri::Wry>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let origin = request
        .headers()
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let allowed = matches!(
        origin,
        "http://tauri.localhost"
            | "https://tauri.localhost"
            | "tauri://localhost"
            | "http://localhost:1420"
            | "http://plugin.localhost"
            | "https://plugin.localhost"
            | "plugin://localhost"
    );
    let result = if allowed || origin.is_empty() {
        context
            .app_handle()
            .try_state::<Arc<PluginManager>>()
            .ok_or("插件服务尚未就绪".to_string())
            .and_then(|manager| manager.resource(&request))
    } else {
        Err("插件资源来源无效".into())
    };
    let mut builder = tauri::http::Response::builder()
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff");
    if allowed {
        builder = builder.header("Access-Control-Allow-Origin", origin);
    }
    match result {
        Ok((bytes, mime)) => builder
            .header("Content-Type", mime)
            .body(bytes)
            .expect("valid response"),
        Err(_) => builder
            .status(403)
            .body(Vec::new())
            .expect("valid response"),
    }
}
