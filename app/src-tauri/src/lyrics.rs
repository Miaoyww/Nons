use crate::{
    model::{AppResult, Lyrics, Track, TrackSource},
    netease::Netease,
    storage::{now_seconds, Store, MAX_LYRIC_BYTES},
    ttml_cache::TtmlCache,
};
use quick_xml::{events::Event, Reader};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::Emitter;

const FOUND_TTL: i64 = 600;
const MISS_TTL: i64 = 86400;

pub struct LyricService {
    store: Arc<Store>,
    netease: Arc<Netease>,
    client: reqwest::Client,
    refreshing: Mutex<HashSet<String>>,
    retry_after: Mutex<HashMap<String, i64>>,
    disk: Arc<TtmlCache>,
}

enum Lookup {
    Found(Lyrics),
    Missing,
    Failed,
}

impl LyricService {
    pub fn new(store: Arc<Store>, netease: Arc<Netease>, disk: Arc<TtmlCache>) -> AppResult<Self> {
        let client = reqwest::Client::builder()
            .user_agent("NonsPlayer/0.1")
            .connect_timeout(Duration::from_millis(500))
            .timeout(Duration::from_secs(1))
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self {
            store,
            netease,
            client,
            refreshing: Mutex::new(HashSet::new()),
            retry_after: Mutex::new(HashMap::new()),
            disk,
        })
    }

    pub async fn get(
        self: &Arc<Self>,
        track: Track,
        refresh: bool,
        skip_amll: bool,
        skip_local: bool,
        app: tauri::AppHandle,
    ) -> AppResult<Option<Lyrics>> {
        if !skip_local {
            if let TrackSource::Local { path, .. } = &track.source {
                if let Some(local) = local_lyrics(path).await? {
                    return Ok(Some(local));
                }
            }
        }
        let Some(id) = track.netease_id() else {
            return Ok(None);
        };
        let amll_key = format!("amll:{id}");
        let ncm_key = format!("netease:{id}");
        if refresh {
            self.store.invalidate_lyrics(&amll_key)?;
            self.store.invalidate_lyrics(&ncm_key)?;
            let _ = self.disk.invalidate(&amll_key);
            self.retry_after
                .lock()
                .map_err(|_| "歌词状态不可用")?
                .remove(&amll_key);
        }
        if !skip_amll {
            // Disk failure is a cache miss; it must never prevent online fallback.
            if let Some(cached) = self
                .store
                .cached_lyrics(&amll_key)?
                .or_else(|| self.disk.get(&amll_key).ok().flatten())
            {
                if let Some(value) = cached.value {
                    if !cached.fresh {
                        let mut refreshing =
                            self.refreshing.lock().map_err(|_| "歌词状态不可用")?;
                        if refreshing.insert(amll_key.clone()) {
                            let this = Arc::clone(self);
                            let key = track.key.clone();
                            let cache_key = amll_key.clone();
                            tauri::async_runtime::spawn(async move {
                                if let Ok(Some(lyrics)) = this.update_amll(id).await {
                                    let _ = app.emit(
                                        "lyrics-updated",
                                        serde_json::json!({"key":key,"lyrics":lyrics}),
                                    );
                                }
                                if let Ok(mut pending) = this.refreshing.lock() {
                                    pending.remove(&cache_key);
                                }
                            });
                        }
                    }
                    return Ok(Some(value));
                }
                if !cached.fresh {
                    if let Some(value) = self.update_amll(id).await? {
                        return Ok(Some(value));
                    }
                }
            } else if let Some(value) = self.update_amll(id).await? {
                return Ok(Some(value));
            }
        }
        if !refresh {
            if let Some(cached) = self.store.cached_lyrics(&ncm_key)? {
                if cached.fresh {
                    return Ok(cached.value);
                }
            }
        }
        let generation = self.disk.generation();
        let value = self.netease.lyrics(id).await?;
        let _ = self.disk.cache_result(
            &ncm_key,
            value.as_ref(),
            if value.is_some() { FOUND_TTL } else { MISS_TTL },
            generation,
        );
        Ok(value)
    }

    async fn update_amll(&self, id: u64) -> AppResult<Option<Lyrics>> {
        let generation = self.disk.generation();
        let key = format!("amll:{id}");
        if self
            .retry_after
            .lock()
            .map_err(|_| "歌词状态不可用")?
            .get(&key)
            .is_some_and(|t| *t > now_seconds())
        {
            return Ok(None);
        }
        match self.lookup(id).await {
            Lookup::Found(lyrics) => {
                let _ = self
                    .disk
                    .cache_result(&key, Some(&lyrics), FOUND_TTL, generation);
                Ok(Some(lyrics))
            }
            Lookup::Missing => {
                let _ = self.disk.cache_result(&key, None, MISS_TTL, generation);
                Ok(None)
            }
            Lookup::Failed => {
                let mut retries = self.retry_after.lock().map_err(|_| "歌词状态不可用")?;
                retries.retain(|_, t| *t > now_seconds());
                if retries.len() < 2000 {
                    retries.insert(key, now_seconds() + 30);
                }
                Ok(None)
            }
        }
    }

    async fn lookup(&self, id: u64) -> Lookup {
        let defaults = vec!["https://raw.githubusercontent.com/amll-dev/amll-ttml-db/refs/heads/main/ncm-lyrics/{id}.ttml".to_string(), "https://amll-ttml-db.stevexmh.net/ncm/{id}".to_string()];
        let endpoints: Vec<String> = self
            .store
            .setting("lyricEndpoints")
            .ok()
            .flatten()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or(defaults);
        let task = async {
            let mut all_missing = !endpoints.is_empty();
            for endpoint in endpoints.iter().take(3) {
                let address = endpoint.replace("{id}", &id.to_string());
                if !url::Url::parse(&address).is_ok_and(|u| u.scheme() == "https") {
                    all_missing = false;
                    continue;
                }
                let request = self
                    .client
                    .get(address)
                    .timeout(Duration::from_millis(500))
                    .send()
                    .await;
                let Ok(mut response) = request else {
                    all_missing = false;
                    continue;
                };
                if response.status() == reqwest::StatusCode::NOT_FOUND {
                    continue;
                }
                if !response.status().is_success() {
                    all_missing = false;
                    continue;
                }
                if response
                    .content_length()
                    .is_some_and(|n| n > MAX_LYRIC_BYTES as u64)
                {
                    all_missing = false;
                    continue;
                }
                let mut bytes = Vec::new();
                let mut valid = true;
                loop {
                    match response.chunk().await {
                        Ok(Some(chunk)) if bytes.len() + chunk.len() <= MAX_LYRIC_BYTES => {
                            bytes.extend_from_slice(&chunk)
                        }
                        Ok(None) => break,
                        _ => {
                            valid = false;
                            break;
                        }
                    }
                }
                if valid {
                    if let Ok(content) = String::from_utf8(bytes) {
                        if valid_ttml(&content) {
                            return Lookup::Found(Lyrics {
                                source: "amll".into(),
                                format: "ttml".into(),
                                content,
                                translation: None,
                                romanization: None,
                            });
                        }
                    }
                }
                all_missing = false;
            }
            if all_missing {
                Lookup::Missing
            } else {
                Lookup::Failed
            }
        };
        tokio::time::timeout(Duration::from_secs(1), task)
            .await
            .unwrap_or(Lookup::Failed)
    }
}

async fn local_lyrics(path: &str) -> AppResult<Option<Lyrics>> {
    for extension in ["ttml", "yrc", "lrc"] {
        let path = PathBuf::from(path).with_extension(extension);
        let metadata = match tokio::fs::metadata(&path).await {
            Ok(m) => m,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return Err("无法读取本地歌词文件".into()),
        };
        if metadata.len() > MAX_LYRIC_BYTES as u64 {
            continue;
        }
        let Ok(content) = tokio::fs::read_to_string(path).await else {
            continue;
        };
        if extension == "ttml" && !valid_ttml(&content) {
            continue;
        }
        return Ok(Some(Lyrics {
            source: "local".into(),
            format: extension.into(),
            content,
            translation: None,
            romanization: None,
        }));
    }
    Ok(None)
}

// This only validates the XML envelope. The AMLL parser owns lyric semantics.
pub fn valid_ttml(content: &str) -> bool {
    if content.len() > MAX_LYRIC_BYTES {
        return false;
    }
    let mut reader = Reader::from_str(content);
    let mut root = false;
    let mut body = false;
    let mut depth = 0usize;
    let mut closed = false;
    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                if closed {
                    return false;
                }
                if !root {
                    if e.local_name().as_ref() != b"tt" {
                        return false;
                    }
                    root = true;
                }
                if e.local_name().as_ref() == b"body" {
                    body = true;
                }
                depth += 1;
            }
            Ok(Event::Empty(e)) => {
                if closed || !root {
                    return false;
                }
                if e.local_name().as_ref() == b"body" {
                    body = true;
                }
            }
            Ok(Event::End(_)) => {
                if depth == 0 {
                    return false;
                }
                depth -= 1;
                if depth == 0 {
                    closed = true;
                }
            }
            Ok(Event::DocType(_)) | Err(_) => return false,
            Ok(Event::Eof) => return root && body && closed && depth == 0,
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn server_error_pages_and_truncated_xml_are_not_lyrics() {
        assert!(!valid_ttml("<html><body>Unavailable</body></html>"));
        assert!(!valid_ttml("<tt><body>"));
        assert!(!valid_ttml(
            "<!DOCTYPE tt SYSTEM 'example'><tt><body/></tt>"
        ));
        assert!(valid_ttml(
            "<tt xmlns='http://www.w3.org/ns/ttml'><body/></tt>"
        ));
    }
}
