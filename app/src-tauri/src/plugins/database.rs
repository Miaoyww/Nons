use crate::model::AppResult;
use rusqlite::{params, Connection, OptionalExtension};
use std::{path::Path, sync::Mutex};

pub struct Database(Mutex<Connection>);
impl Database {
    pub fn open(path: &Path) -> AppResult<Self> {
        let db = Connection::open(path).map_err(|e| e.to_string())?;
        db.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS plugins (id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS storage (plugin TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(plugin,key)); CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);").map_err(|e| e.to_string())?;
        Ok(Self(Mutex::new(db)))
    }
    fn lock(&self) -> AppResult<std::sync::MutexGuard<'_, Connection>> {
        self.0.lock().map_err(|_| "插件存储不可用".into())
    }
    pub fn enabled(&self, id: &str) -> AppResult<bool> {
        Ok(self
            .lock()?
            .query_row("SELECT enabled FROM plugins WHERE id=?1", [id], |r| {
                r.get::<_, bool>(0)
            })
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(false))
    }
    pub fn enable(&self, id: &str, value: bool) -> AppResult<()> {
        self.lock()?.execute("INSERT INTO plugins(id,enabled) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled", params![id,value]).map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn initialized(&self) -> AppResult<bool> {
        Ok(self
            .lock()?
            .query_row("SELECT value FROM settings WHERE key='bundled'", [], |r| {
                r.get::<_, String>(0)
            })
            .optional()
            .map_err(|e| e.to_string())?
            .is_some())
    }
    pub fn mark_initialized(&self) -> AppResult<()> {
        self.lock()?
            .execute("INSERT OR REPLACE INTO settings VALUES('bundled','1')", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub fn remove(&self, id: &str) -> AppResult<()> {
        let mut db = self.lock()?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM plugins WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM storage WHERE plugin=?1", [id])
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }
    pub fn get(&self, id: &str, key: &str) -> AppResult<Option<String>> {
        check_key(key)?;
        self.lock()?
            .query_row(
                "SELECT value FROM storage WHERE plugin=?1 AND key=?2",
                params![id, key],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())
    }
    pub fn set(&self, id: &str, key: &str, value: &str) -> AppResult<()> {
        check_key(key)?;
        if value.len() > 65536 {
            return Err("插件存储单值超过 64KiB".into());
        }
        serde_json::from_str::<serde_json::Value>(value).map_err(|_| "存储值必须为 JSON")?;
        let mut db = self.lock()?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let total: i64 = tx.query_row("SELECT coalesce(sum(length(CAST(key AS BLOB))+length(CAST(value AS BLOB))),0) FROM storage WHERE plugin=?1 AND key!=?2", params![id,key], |r| r.get(0)).map_err(|e| e.to_string())?;
        if total + (key.len() + value.len()) as i64 > 1024 * 1024 {
            return Err("插件存储超过 1MiB".into());
        }
        tx.execute("INSERT INTO storage VALUES(?1,?2,?3) ON CONFLICT(plugin,key) DO UPDATE SET value=excluded.value", params![id,key,value]).map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }
    pub fn delete(&self, id: &str, key: &str) -> AppResult<()> {
        check_key(key)?;
        self.lock()?
            .execute(
                "DELETE FROM storage WHERE plugin=?1 AND key=?2",
                params![id, key],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
fn check_key(key: &str) -> AppResult<()> {
    if key.is_empty() || key.len() > 128 {
        Err("存储键无效".into())
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn storage_isolation_and_quota() {
        let db = Database::open(Path::new(":memory:")).unwrap();
        db.set("a", "key", "123").unwrap();
        assert_eq!(db.get("b", "key").unwrap(), None);
        db.delete("b", "key").unwrap();
        assert_eq!(db.get("a", "key").unwrap().as_deref(), Some("123"));
        assert!(db
            .set("a", "large", &format!("\"{}\"", "a".repeat(65536)))
            .is_err());
        db.remove("a").unwrap();
        assert_eq!(db.get("a", "key").unwrap(), None);
    }
}
