mod library;
mod lyrics;
mod media;
mod model;
mod netease;
mod network;
mod player;
mod storage;

use model::{AppResult, Lyrics, OutputDevice, PlayerSnapshot, Track, TrackSource};
use netease::{AccountProfile, LoginStatus, Netease, QrLogin};
use player::{Command, Player};
use std::{path::PathBuf, sync::Arc};
use tauri::{Manager, State};

struct Backend {
    store: Arc<storage::Store>,
    netease: Arc<Netease>,
    lyrics: Arc<lyrics::LyricService>,
    player: Arc<Player>,
    covers: PathBuf,
    fallback_cover: String,
}

#[tauri::command]
fn player_snapshot(backend: State<'_, Backend>) -> AppResult<PlayerSnapshot> {
    backend.player.snapshot()
}

#[tauri::command]
async fn search_music(
    keyword: String,
    offset: u32,
    backend: State<'_, Backend>,
) -> AppResult<Vec<Track>> {
    let mut tracks = backend.netease.search(&keyword, offset.min(10_000)).await?;
    for track in &mut tracks {
        if track.cover.is_empty() {
            track.cover = backend.fallback_cover.clone();
        }
    }
    backend.store.save_tracks(&tracks)?;
    Ok(tracks)
}

#[tauri::command]
async fn local_music(
    keyword: String,
    offset: u32,
    backend: State<'_, Backend>,
) -> AppResult<Vec<Track>> {
    let store = backend.store.clone();
    tauri::async_runtime::spawn_blocking(move || store.local_tracks(&keyword, offset))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn import_music(
    paths: Vec<String>,
    backend: State<'_, Backend>,
) -> AppResult<library::ImportReport> {
    let store = backend.store.clone();
    let covers = backend.covers.clone();
    let fallback = backend.fallback_cover.clone();
    tauri::async_runtime::spawn_blocking(move || library::import(paths, store, covers, fallback))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn play_queue(keys: Vec<String>, index: usize, backend: State<'_, Backend>) -> AppResult<()> {
    if keys.is_empty() || keys.len() > 1000 || index >= keys.len() {
        return Err("播放队列无效".into());
    }
    let tracks = keys
        .iter()
        .map(|key| backend.store.track(key))
        .collect::<AppResult<Vec<_>>>()?;
    backend.player.send(Command::Queue(tracks, index))
}

#[tauri::command]
fn append_queue(keys: Vec<String>, backend: State<'_, Backend>) -> AppResult<()> {
    if keys.is_empty() || keys.len() > 1000 {
        return Err("待添加的歌曲无效".into());
    }
    let tracks = keys
        .iter()
        .map(|key| backend.store.track(key))
        .collect::<AppResult<Vec<_>>>()?;
    backend.player.send(Command::Append(tracks))
}

#[tauri::command]
fn player_action(action: &str, backend: State<'_, Backend>) -> AppResult<()> {
    let command = match action {
        "pause" => Command::Pause,
        "resume" => Command::Resume,
        "stop" => Command::Stop,
        "next" => Command::Next,
        "previous" => Command::Previous,
        _ => return Err("播放操作无效".into()),
    };
    backend.player.send(command)
}

#[tauri::command]
fn player_jump(index: usize, backend: State<'_, Backend>) -> AppResult<()> {
    backend.player.send(Command::Jump(index))
}
#[tauri::command]
fn player_seek(position_ms: u64, backend: State<'_, Backend>) -> AppResult<()> {
    backend.player.send(Command::Seek(position_ms))
}
#[tauri::command]
fn player_volume(volume: f64, backend: State<'_, Backend>) -> AppResult<()> {
    backend.player.send(Command::Volume(volume))
}
#[tauri::command]
fn player_device(device_id: Option<String>, backend: State<'_, Backend>) -> AppResult<()> {
    backend.player.send(Command::Device(device_id))
}
#[tauri::command]
async fn output_devices(backend: State<'_, Backend>) -> AppResult<Vec<OutputDevice>> {
    let player = backend.player.clone();
    tauri::async_runtime::spawn_blocking(move || player.devices())
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn track_lyrics(
    key: String,
    refresh: bool,
    skip_amll: bool,
    skip_local: bool,
    app: tauri::AppHandle,
    backend: State<'_, Backend>,
) -> AppResult<Option<Lyrics>> {
    let track = backend.store.track(&key)?;
    backend
        .lyrics
        .get(track, refresh, skip_amll, skip_local, app)
        .await
}

#[tauri::command]
fn bind_local_lyrics(
    key: String,
    netease_id: Option<u64>,
    backend: State<'_, Backend>,
) -> AppResult<()> {
    if netease_id == Some(0) {
        return Err("网易云歌曲 ID 无效".into());
    }
    let mut track = backend.store.track(&key)?;
    match &mut track.source {
        TrackSource::Local { netease_id: id, .. } => *id = netease_id,
        _ => return Err("仅本地音乐需要手动绑定歌词".into()),
    }
    backend.store.save_tracks(&[track])
}

#[tauri::command]
fn music_options(backend: State<'_, Backend>) -> AppResult<serde_json::Value> {
    Ok(
        serde_json::json!({ "quality": backend.store.setting("quality")?.unwrap_or_else(|| "exhigh".into()), "allowDowngrade": backend.store.setting("allowDowngrade")?.as_deref() != Some("false") }),
    )
}

#[tauri::command]
fn set_music_options(
    quality: String,
    allow_downgrade: bool,
    backend: State<'_, Backend>,
) -> AppResult<()> {
    if !["standard", "higher", "exhigh", "lossless", "hires"].contains(&quality.as_str()) {
        return Err("音质设置无效".into());
    }
    backend.store.set_setting("quality", &quality)?;
    backend.store.set_setting(
        "allowDowngrade",
        if allow_downgrade { "true" } else { "false" },
    )
}

#[tauri::command]
fn set_lyric_endpoints(endpoints: Vec<String>, backend: State<'_, Backend>) -> AppResult<()> {
    if endpoints.is_empty()
        || endpoints.len() > 3
        || endpoints.iter().any(|e| {
            e.len() > 2048
                || !e.contains("{id}")
                || !url::Url::parse(&e.replace("{id}", "1"))
                    .is_ok_and(|u| u.scheme() == "https" && u.host_str().is_some())
        })
    {
        return Err("设置 1–3 个 HTTPS 歌词地址，使用 {id} 表示歌曲 ID".into());
    }
    backend.store.set_setting(
        "lyricEndpoints",
        &serde_json::to_string(&endpoints).map_err(|e| e.to_string())?,
    )
}

#[tauri::command]
async fn qr_login(backend: State<'_, Backend>) -> AppResult<QrLogin> {
    backend.netease.qr_login().await
}
#[tauri::command]
async fn poll_login(key: String, backend: State<'_, Backend>) -> AppResult<LoginStatus> {
    backend.netease.poll_login(&key).await
}
#[tauri::command]
async fn login_session(backend: State<'_, Backend>) -> AppResult<bool> {
    backend.netease.session().await
}
#[tauri::command]
async fn account_profile(backend: State<'_, Backend>) -> AppResult<Option<AccountProfile>> {
    backend.netease.profile().await
}
#[tauri::command]
fn logout(backend: State<'_, Backend>) -> AppResult<()> {
    backend.netease.logout()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data)?;
            let covers = app.path().app_cache_dir()?.join("covers");
            std::fs::create_dir_all(&covers)?;
            let fallback = covers.join("default.png");
            if !fallback.exists() {
                std::fs::write(&fallback, include_bytes!("../icons/128x128.png"))?;
            }
            let store = Arc::new(storage::Store::open(&data.join("nons.sqlite3"))?);
            let netease = Arc::new(Netease::new()?);
            let lyrics = Arc::new(lyrics::LyricService::new(store.clone(), netease.clone())?);
            #[cfg(windows)]
            let hwnd = app
                .get_webview_window("main")
                .ok_or("主窗口不可用")?
                .hwnd()?
                .0 as isize;
            #[cfg(not(windows))]
            let hwnd = 0;
            let player = Arc::new(Player::start(
                app.handle().clone(),
                store.clone(),
                netease.clone(),
                hwnd,
            )?);
            app.manage(Backend {
                store,
                netease,
                lyrics,
                player,
                covers,
                fallback_cover: fallback.to_string_lossy().to_string(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            player_snapshot,
            search_music,
            local_music,
            import_music,
            play_queue,
            append_queue,
            player_action,
            player_jump,
            player_seek,
            player_volume,
            player_device,
            output_devices,
            track_lyrics,
            bind_local_lyrics,
            music_options,
            set_music_options,
            set_lyric_endpoints,
            qr_login,
            poll_login,
            login_session,
            account_profile,
            logout
        ])
        .build(tauri::generate_context!())
        .expect("无法启动 NonsPlayer");
    app.run(|app, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            app.state::<Backend>().player.shutdown();
        }
    });
}
