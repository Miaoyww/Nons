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

type CacheStamp = (crate::music::account::SessionContext, u64);
type CacheEntry = (CacheStamp, u64, Instant, Track);

pub struct SongService {
    netease: Arc<Netease>,
    generation: AtomicU64,
    music: Arc<crate::music::service::MusicService>,
    cache: tokio::sync::Mutex<HashMap<u64, CacheEntry>>,
}
impl SongService {
    pub(super) fn account_credentials(&self) -> AppResult<Value> {
        Ok(
            json!({"cookie":self.netease.account_credentials()?,"generation":self.generation.load(Ordering::SeqCst)}),
        )
    }
    pub fn new(netease: Arc<Netease>, music: Arc<crate::music::service::MusicService>) -> Self {
        Self {
            netease,
            music,
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
        let stamp = self.music.legacy_stamp()?;
        let generation = self.generation.load(Ordering::SeqCst);
        let mut cache = self.cache.lock().await;
        cache.retain(|_, (entry_stamp, entry_generation, time, _)| {
            *entry_stamp == stamp
                && *entry_generation == generation
                && time.elapsed() < Duration::from_secs(600)
        });
        // Cache entries belong to the account generation in which they were fetched.
        if generation != self.generation.load(Ordering::SeqCst)
            || stamp != self.music.legacy_stamp()?
        {
            return Err("账号状态已变化".into());
        }
        if let Some((_, _, _, track)) = cache.get(&id) {
            return Ok(track.clone());
        }
        let track = tokio::time::timeout(Duration::from_secs(3), self.music.legacy_track(id))
            .await
            .map_err(|_| "歌曲信息查询超时")??;
        if generation != self.generation.load(Ordering::SeqCst)
            || stamp != self.music.legacy_stamp()?
        {
            cache.clear();
            return Err("账号状态已变化".into());
        }
        while cache.len() >= 128 {
            if let Some(key) = cache
                .iter()
                .min_by_key(|(_, (_, _, time, _))| *time)
                .map(|(key, _)| *key)
            {
                cache.remove(&key);
            }
        }
        let value = song_value(id, &track);
        if serde_json::to_vec(&value).map_err(|e| e.to_string())?.len() > MAX_JSON {
            return Err("歌曲信息过大".into());
        }
        cache.insert(id, (stamp, generation, Instant::now(), track.clone()));
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
