use crate::model::{AppResult, Lyrics, PlayerSnapshot, Track};
use rusqlite::{params, Connection, OptionalExtension};
use std::{
    path::Path,
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

pub const MAX_LYRIC_BYTES: usize = 2 * 1024 * 1024;
const LYRIC_CACHE_BYTES: i64 = 64 * 1024 * 1024;

pub struct Store(Mutex<Connection>);

pub struct CachedLyrics {
    pub value: Option<Lyrics>,
    pub fresh: bool,
}

pub fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

impl Store {
    pub fn open(path: &Path) -> AppResult<Self> {
        let connection = Connection::open(path).map_err(|e| e.to_string())?;
        Self::initialize(connection)
    }

    fn initialize(connection: Connection) -> AppResult<Self> {
        connection
            .busy_timeout(Duration::from_secs(2))
            .map_err(|e| e.to_string())?;
        connection.execute_batch("PRAGMA auto_vacuum=INCREMENTAL;
            PRAGMA journal_mode=WAL;
            PRAGMA synchronous=NORMAL;
            CREATE TABLE IF NOT EXISTS tracks (key TEXT PRIMARY KEY, source TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL, value TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS tracks_source ON tracks(source);
            CREATE TABLE IF NOT EXISTS lyric_cache (key TEXT PRIMARY KEY, value TEXT, expires INTEGER NOT NULL, accessed INTEGER NOT NULL, bytes INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            PRAGMA user_version=1;").map_err(|e| e.to_string())?;
        Ok(Self(Mutex::new(connection)))
    }

    pub fn save_tracks(&self, tracks: &[Track]) -> AppResult<()> {
        let mut db = self.0.lock().map_err(|_| "曲库锁不可用")?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        {
            let mut insert = tx.prepare_cached("INSERT INTO tracks(key,source,title,artist,value) VALUES(?1,?2,?3,?4,?5)
                ON CONFLICT(key) DO UPDATE SET title=excluded.title,artist=excluded.artist,value=excluded.value").map_err(|e| e.to_string())?;
            for track in tracks {
                let source = if matches!(track.source, crate::model::TrackSource::Local { .. }) {
                    "local"
                } else {
                    "netease"
                };
                insert
                    .execute(params![
                        track.key,
                        source,
                        track.title,
                        track.artist,
                        serde_json::to_string(track).map_err(|e| e.to_string())?
                    ])
                    .map_err(|e| e.to_string())?;
            }
        }
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn track(&self, key: &str) -> AppResult<Track> {
        let db = self.0.lock().map_err(|_| "曲库锁不可用")?;
        let value: String = db
            .query_row("SELECT value FROM tracks WHERE key=?1", [key], |row| {
                row.get(0)
            })
            .map_err(|_| "歌曲不存在，请刷新曲库")?;
        serde_json::from_str(&value).map_err(|e| e.to_string())
    }

    pub fn local_tracks(&self, search: &str, offset: u32) -> AppResult<Vec<Track>> {
        let db = self.0.lock().map_err(|_| "曲库锁不可用")?;
        let mut statement = db.prepare_cached("SELECT value FROM tracks WHERE source='local' AND (instr(lower(title),lower(?1))>0 OR instr(lower(artist),lower(?1))>0) ORDER BY title,key LIMIT 100 OFFSET ?2").map_err(|e| e.to_string())?;
        let rows = statement
            .query_map(params![search, offset], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.map(|row| {
            serde_json::from_str(&row.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
        })
        .collect()
    }

    pub fn setting(&self, key: &str) -> AppResult<Option<String>> {
        self.0
            .lock()
            .map_err(|_| "配置锁不可用")?
            .query_row("SELECT value FROM settings WHERE key=?1", [key], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())
    }

    pub fn set_setting(&self, key: &str, value: &str) -> AppResult<()> {
        self.0.lock().map_err(|_| "配置锁不可用")?.execute("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![key, value]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn save_player(&self, state: &PlayerSnapshot) -> AppResult<()> {
        self.set_setting(
            "player",
            &serde_json::to_string(state).map_err(|e| e.to_string())?,
        )
    }

    pub fn cached_lyrics(&self, key: &str) -> AppResult<Option<CachedLyrics>> {
        let db = self.0.lock().map_err(|_| "歌词缓存锁不可用")?;
        let row: Option<(Option<String>, i64)> = db
            .query_row(
                "SELECT value,expires FROM lyric_cache WHERE key=?1",
                [key],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some((value, expires)) = row {
            db.execute(
                "UPDATE lyric_cache SET accessed=?2 WHERE key=?1",
                params![key, now_seconds()],
            )
            .map_err(|e| e.to_string())?;
            Ok(Some(CachedLyrics {
                value: value
                    .map(|s| serde_json::from_str(&s))
                    .transpose()
                    .map_err(|e| e.to_string())?,
                fresh: expires > now_seconds(),
            }))
        } else {
            Ok(None)
        }
    }

    pub fn cache_lyrics(&self, key: &str, value: Option<&Lyrics>, ttl: i64) -> AppResult<()> {
        let value = value
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| e.to_string())?;
        let size = value.as_ref().map_or(0, |s| s.len());
        if size > MAX_LYRIC_BYTES {
            return Err("歌词文件过大".into());
        }
        let mut db = self.0.lock().map_err(|_| "歌词缓存锁不可用")?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO lyric_cache(key,value,expires,accessed,bytes) VALUES(?1,?2,?3,?4,?5)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires=excluded.expires,accessed=excluded.accessed,bytes=excluded.bytes",
            params![key, value, now_seconds() + ttl, now_seconds(), size as i64]).map_err(|e| e.to_string())?;
        loop {
            let (bytes, count): (i64, i64) = tx
                .query_row(
                    "SELECT COALESCE(SUM(bytes),0),COUNT(*) FROM lyric_cache",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .map_err(|e| e.to_string())?;
            if bytes <= LYRIC_CACHE_BYTES && count <= 2000 {
                break;
            }
            tx.execute("DELETE FROM lyric_cache WHERE key=(SELECT key FROM lyric_cache ORDER BY accessed,key LIMIT 1)", []).map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        db.execute_batch("PRAGMA incremental_vacuum(32)")
            .map_err(|e| e.to_string())
    }

    pub fn invalidate_lyrics(&self, key: &str) -> AppResult<()> {
        self.0
            .lock()
            .map_err(|_| "歌词缓存锁不可用")?
            .execute("DELETE FROM lyric_cache WHERE key=?1", [key])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn absence_and_expired_lyrics_are_distinct() {
        let store = Store::initialize(Connection::open_in_memory().unwrap()).unwrap();
        assert!(store.cached_lyrics("amll:1").unwrap().is_none());
        store.cache_lyrics("amll:1", None, 86400).unwrap();
        let miss = store.cached_lyrics("amll:1").unwrap().unwrap();
        assert!(miss.fresh && miss.value.is_none());
        let lyrics = Lyrics {
            source: "amll".into(),
            format: "ttml".into(),
            content: "example".into(),
            translation: None,
            romanization: None,
        };
        store.cache_lyrics("amll:2", Some(&lyrics), -1).unwrap();
        let stale = store.cached_lyrics("amll:2").unwrap().unwrap();
        assert!(!stale.fresh && stale.value.is_some());
    }
    #[test]
    fn large_lyrics_are_rejected_before_writing() {
        let store = Store::initialize(Connection::open_in_memory().unwrap()).unwrap();
        let lyrics = Lyrics {
            source: "amll".into(),
            format: "ttml".into(),
            content: "a".repeat(MAX_LYRIC_BYTES),
            translation: None,
            romanization: None,
        };
        assert!(store.cache_lyrics("amll:1", Some(&lyrics), 1).is_err());
        assert!(store.cached_lyrics("amll:1").unwrap().is_none());
    }
}
