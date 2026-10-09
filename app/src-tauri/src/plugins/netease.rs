use super::capability::MAX_JSON;
use crate::{
    model::{AppResult, Track},
    netease::Netease,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

pub struct SongService {
    netease: Arc<Netease>,
    generation: AtomicU64,
    cache: tokio::sync::Mutex<HashMap<u64, (u64, Instant, Track)>>,
}
impl SongService {
    pub fn new(netease: Arc<Netease>) -> Self {
        Self {
            netease,
            generation: AtomicU64::new(0),
            cache: Default::default(),
        }
    }
    pub fn invalidate(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
    }
    pub async fn song(&self, id: u64) -> AppResult<Value> {
        Ok(song_value(id, &self.track(id).await?))
    }
    pub(super) async fn track(&self, id: u64) -> AppResult<Track> {
        // A bounded serial fetch also coalesces duplicate concurrent requests.
        let generation = self.generation.load(Ordering::SeqCst);
        let mut cache = self.cache.lock().await;
        cache.retain(|_, (entry_generation, time, _)| {
            *entry_generation == generation && time.elapsed() < Duration::from_secs(600)
        });
        // Cache entries belong to the account generation in which they were fetched.
        if generation != self.generation.load(Ordering::SeqCst) {
            return Err("账号状态已变化".into());
        }
        if let Some((_, _, track)) = cache.get(&id) {
            return Ok(track.clone());
        }
        let track = tokio::time::timeout(Duration::from_secs(3), self.netease.song(id))
            .await
            .map_err(|_| "歌曲信息查询超时")??;
        if generation != self.generation.load(Ordering::SeqCst) {
            cache.clear();
            return Err("账号状态已变化".into());
        }
        while cache.len() >= 128 {
            if let Some(key) = cache
                .iter()
                .min_by_key(|(_, (_, time, _))| *time)
                .map(|(key, _)| *key)
            {
                cache.remove(&key);
            }
        }
        let value = song_value(id, &track);
        if serde_json::to_vec(&value).map_err(|e| e.to_string())?.len() > MAX_JSON {
            return Err("歌曲信息过大".into());
        }
        cache.insert(id, (generation, Instant::now(), track.clone()));
        Ok(track)
    }
    pub async fn clear(&self) {
        self.invalidate();
        self.cache.lock().await.clear();
    }
}
fn song_value(id: u64, track: &Track) -> Value {
    json!({"id":id,"key":track.key,"title":track.title,"artist":track.artist,"artists":track.artists,"album":track.album,"durationMs":track.duration_ms,"cover":track.cover})
}
