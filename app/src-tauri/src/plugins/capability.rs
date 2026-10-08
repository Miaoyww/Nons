use super::database::Database;
use crate::{
    model::{AppResult, Track},
    netease::Netease,
    player::{Command, Player},
};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tauri::Emitter;

pub const MAX_JSON: usize = 64 * 1024;
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
    async fn track(&self, id: u64) -> AppResult<Track> {
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

#[derive(Clone)]
pub struct Context {
    pub id: String,
    pub generation: u64,
    pub permissions: HashSet<String>,
    pub active: Arc<AtomicBool>,
    pub database: Arc<Database>,
    pub songs: Arc<SongService>,
    pub player: Arc<Player>,
    pub app: tauri::AppHandle,
    pub event_budget: Arc<std::sync::Mutex<(Instant, usize)>>,
    pub requests: Arc<tokio::sync::Semaphore>,
}
impl Context {
    pub fn check(&self, permission: Option<&str>) -> AppResult<()> {
        if !self.active.load(Ordering::SeqCst) {
            return Err("插件已卸载或禁用".into());
        }
        if permission.is_some_and(|p| !self.permissions.contains(p)) {
            return Err("插件缺少所需权限".into());
        }
        Ok(())
    }
    pub async fn call(&self, operation: &str, args: &str) -> AppResult<String> {
        if args.len() > MAX_JSON {
            return Err("插件请求过大".into());
        }
        let args: Value = serde_json::from_str(args).map_err(|_| "插件参数必须为 JSON")?;
        let result = match operation {
            "music.get-song" => {
                self.check(Some("music:metadata"))?;
                self.songs
                    .song(
                        args.get("id")
                            .and_then(Value::as_u64)
                            .ok_or("缺少歌曲 ID")?,
                    )
                    .await?
            }
            "events.emit" => {
                self.check(None)?;
                let name = text(&args, "event")?;
                if name.len() > 64
                    || name.is_empty()
                    || !name
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                {
                    return Err("事件名称无效".into());
                }
                let mut budget = self.event_budget.lock().map_err(|_| "事件限制不可用")?;
                if budget.0.elapsed() >= Duration::from_secs(1) {
                    *budget = (Instant::now(), 0);
                }
                budget.1 += 1;
                if budget.1 > 32 {
                    return Err("插件事件发送过于频繁".into());
                }
                self.app.emit("plugin-event", json!({"pluginId":self.id,"generation":self.generation,"namespace":format!("plugin:{}:{name}",self.id),"event":name,"payload":args.get("payload").unwrap_or(&Value::Null)})).map_err(|e| e.to_string())?;
                Value::Null
            }
            "storage.get" | "storage.set" | "storage.delete" => {
                self.check(Some("storage"))?;
                let key = text(&args, "key")?;
                match operation {
                    "storage.get" => self
                        .database
                        .get(&self.id, key)?
                        .map(|s| serde_json::from_str(&s).map_err(|e| e.to_string()))
                        .transpose()?
                        .unwrap_or(Value::Null),
                    "storage.set" => {
                        self.database.set(
                            &self.id,
                            key,
                            &serde_json::to_string(args.get("value").ok_or("缺少存储值")?)
                                .map_err(|e| e.to_string())?,
                        )?;
                        Value::Null
                    }
                    _ => {
                        self.database.delete(&self.id, key)?;
                        Value::Null
                    }
                }
            }
            "player.read" => {
                self.check(Some("player:read"))?;
                let state = self.player.snapshot()?;
                json!({"status":state.status,"positionMs":state.position_ms,"durationMs":state.duration_ms,"volume":state.volume,"track":state.current().map(|t| json!({"title":t.title,"artist":t.artist,"album":t.album,"durationMs":t.duration_ms,"cover":if t.cover.starts_with("http") { &t.cover } else { "" }}))})
            }
            "player.play-song" => {
                self.check(Some("player:control"))?;
                self.check(Some("music:metadata"))?;
                let next = match text(&args, "mode")? {
                    "now" => false,
                    "next" => true,
                    _ => return Err("不支持的播放方式".into()),
                };
                let track = self
                    .songs
                    .track(
                        args.get("id")
                            .and_then(Value::as_u64)
                            .ok_or("缺少歌曲 ID")?,
                    )
                    .await?;
                self.check(Some("player:control"))?;
                self.player.send(if next {
                    Command::PlayNext(vec![track])
                } else {
                    Command::Queue(vec![track], 0)
                })?;
                Value::Null
            }
            "player.control" => {
                self.check(Some("player:control"))?;
                let command = match text(&args, "action")? {
                    "pause" => Command::Pause,
                    "resume" => Command::Resume,
                    "next" => Command::Next,
                    "previous" => Command::Previous,
                    "stop" => Command::Stop,
                    _ => return Err("不支持的播放动作".into()),
                };
                self.player.send(command)?;
                Value::Null
            }
            _ => return Err("未知 Host Capability".into()),
        };
        self.check(None)?;
        let result = serde_json::to_string(&result).map_err(|e| e.to_string())?;
        if result.len() > MAX_JSON {
            return Err("插件响应过大".into());
        }
        Ok(result)
    }
}
fn text<'a>(value: &'a Value, key: &str) -> AppResult<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("缺少参数 {key}"))
}
