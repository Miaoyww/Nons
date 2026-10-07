use crate::{
    media::MediaControls,
    model::{
        following_index, AppResult, OutputDevice, PlaybackStatus, PlayerSnapshot, Progress,
        RepeatMode, ResolvedTrack, Track,
    },
    netease::Netease,
    storage::Store,
};
use gstreamer::{self as gst, prelude::*};
use sha2::{Digest, Sha256};
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver, SyncSender},
        Arc, Mutex, RwLock,
    },
    time::{Duration, Instant},
};
use tauri::Emitter;

pub enum Command {
    Queue(Vec<Track>, usize),
    PlayNext(Vec<Track>),
    Jump(usize),
    Pause,
    Resume,
    Stop,
    Clear,
    Remove(usize, String),
    Next,
    Previous,
    Repeat,
    Seek(u64),
    Volume(f64),
    Device(Option<String>),
    Resolved {
        generation: u64,
        index: usize,
        key: String,
        result: Box<AppResult<ResolvedTrack>>,
        next: bool,
    },
    Devices(mpsc::Sender<AppResult<Vec<OutputDevice>>>),
    Shutdown,
}

pub struct Player {
    sender: SyncSender<Command>,
    snapshot: Arc<RwLock<PlayerSnapshot>>,
    thread: Mutex<Option<std::thread::JoinHandle<()>>>,
}

struct Prepared {
    generation: u64,
    index: usize,
    resolved: ResolvedTrack,
}

impl Player {
    pub fn start(
        app: tauri::AppHandle,
        store: Arc<Store>,
        netease: Arc<Netease>,
        hwnd: isize,
    ) -> AppResult<Self> {
        let restored = store
            .setting("player")?
            .and_then(|s| serde_json::from_str::<PlayerSnapshot>(&s).ok())
            .map(|mut s| {
                s.status = PlaybackStatus::Stopped;
                s.error = None;
                s.media_error = None;
                s.revision = 0;
                s.position_ms = 0;
                s.duration_ms = s.current().map_or(0, |t| t.duration_ms);
                s
            })
            .unwrap_or_default();
        let snapshot = Arc::new(RwLock::new(restored));
        let shared = Arc::clone(&snapshot);
        let (sender, receiver) = mpsc::sync_channel(64);
        let actor_sender = sender.clone();
        let thread = std::thread::Builder::new()
            .name("nons-audio".into())
            .spawn(move || {
                let result = Actor::new(
                    app.clone(),
                    store,
                    netease,
                    shared.clone(),
                    actor_sender,
                    hwnd,
                );
                match result {
                    Ok(mut actor) => actor.run(receiver),
                    Err(error) => {
                        if let Ok(mut state) = shared.write() {
                            state.status = PlaybackStatus::Error;
                            state.error = Some(error);
                            let _ = app.emit("player-state", state.clone());
                        }
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(Self {
            sender,
            snapshot,
            thread: Mutex::new(Some(thread)),
        })
    }

    pub fn send(&self, command: Command) -> AppResult<()> {
        self.sender
            .try_send(command)
            .map_err(|_| "播放核心忙碌或不可用，请稍后重试".into())
    }

    pub fn snapshot(&self) -> AppResult<PlayerSnapshot> {
        self.snapshot
            .read()
            .map(|s| s.clone())
            .map_err(|_| "播放状态不可用".into())
    }

    pub fn devices(&self) -> AppResult<Vec<OutputDevice>> {
        let (sender, receiver) = mpsc::channel();
        self.send(Command::Devices(sender))?;
        receiver
            .recv_timeout(Duration::from_secs(3))
            .map_err(|_| "查询音频设备超时".to_string())?
    }

    pub fn shutdown(&self) {
        let _ = self.sender.send(Command::Shutdown);
        if let Ok(mut thread) = self.thread.lock() {
            if let Some(thread) = thread.take() {
                let _ = thread.join();
            }
        }
    }
}

struct Actor {
    app: tauri::AppHandle,
    store: Arc<Store>,
    netease: Arc<Netease>,
    shared: Arc<RwLock<PlayerSnapshot>>,
    sender: SyncSender<Command>,
    state: PlayerSnapshot,
    playbin: gst::Element,
    bus: gst::Bus,
    monitor: gst::DeviceMonitor,
    media: Option<MediaControls>,
    desired_playing: bool,
    generation: Arc<AtomicU64>,
    prepared: Arc<Mutex<Option<Prepared>>>,
    armed: Arc<Mutex<Option<Prepared>>>,
    current_job: Option<tauri::async_runtime::JoinHandle<()>>,
    next_job: Option<tauri::async_runtime::JoinHandle<()>>,
    next_attempt: Option<Instant>,
    next_attempts: u8,
    last_tick: Instant,
    last_save: Instant,
    pending_seek: Option<u64>,
    awaiting_first_stream: bool,
}

impl Actor {
    fn new(
        app: tauri::AppHandle,
        store: Arc<Store>,
        netease: Arc<Netease>,
        shared: Arc<RwLock<PlayerSnapshot>>,
        sender: SyncSender<Command>,
        hwnd: isize,
    ) -> AppResult<Self> {
        gst::init().map_err(|e| format!("GStreamer 初始化失败：{e}"))?;
        crate::network::prefer_http_source();
        let playbin = gst::ElementFactory::make("playbin3")
            .build()
            .map_err(|_| "GStreamer 缺少 playbin3 插件，请检查运行时")?;
        let bus = playbin.bus().ok_or("音频消息总线不可用")?;
        playbin.set_property("buffer-size", 4_194_304_i32);
        playbin.set_property("buffer-duration", 10_000_000_000_i64);
        playbin.set_property_from_str("flags", "audio+soft-volume+buffering");
        playbin.connect("source-setup", false, |values| {
            if let Ok(source) = values[1].get::<gst::Element>() {
                crate::network::configure_source(&source);
            }
            None
        });
        let monitor = gst::DeviceMonitor::new();
        monitor.add_filter(Some("Audio/Sink"), None);
        monitor
            .start()
            .map_err(|e| format!("无法监视音频设备：{e}"))?;
        let mut state = shared.read().map_err(|_| "播放状态不可用")?.clone();
        if let Some(id) = &state.device_id {
            let device = monitor.devices().into_iter().find(|device| {
                let identity = format!(
                    "{}:{}",
                    device.device_class(),
                    device
                        .properties()
                        .map_or_else(|| device.display_name().to_string(), |s| s.to_string())
                );
                format!("{:x}", Sha256::digest(identity.as_bytes())) == *id
            });
            if let Some(device) = device {
                if let Ok(sink) = device.create_element(Some("nons-output")) {
                    playbin.set_property("audio-sink", sink);
                } else {
                    state.device_id = None;
                }
            } else {
                state.device_id = None;
            }
        }
        let media = match MediaControls::new(hwnd, sender.clone()) {
            Ok(m) => Some(m),
            Err(e) => {
                state.media_error = Some(format!("系统媒体控制初始化失败：{e}"));
                None
            }
        };
        let prepared = Arc::new(Mutex::new(None::<Prepared>));
        let armed = Arc::new(Mutex::new(None::<Prepared>));
        let generation = Arc::new(AtomicU64::new(0));
        let pending = prepared.clone();
        let advancing = armed.clone();
        let current_generation = generation.clone();
        playbin.connect("about-to-finish", false, move |values| {
            // Only consume a prepared URI here. This runs on a streaming thread:
            // no HTTP, database work, events, or channel waits are allowed.
            if let Ok(mut slot) = pending.lock() {
                if let Some(next) = slot
                    .take()
                    .filter(|p| p.generation == current_generation.load(Ordering::Acquire))
                {
                    let element = values[0]
                        .get::<gst::Element>()
                        .expect("GStreamer signal instance");
                    if let Ok(mut slot) = advancing.lock() {
                        element.set_property("uri", &next.resolved.uri);
                        *slot = Some(next);
                    }
                }
            }
            None
        });
        playbin.set_property("volume", state.volume.clamp(0.0, 1.0));
        Ok(Self {
            app,
            store,
            netease,
            shared,
            sender,
            state,
            playbin,
            bus,
            monitor,
            media,
            desired_playing: false,
            generation,
            prepared,
            armed,
            current_job: None,
            next_job: None,
            next_attempt: None,
            next_attempts: 0,
            last_tick: Instant::now(),
            last_save: Instant::now(),
            pending_seek: None,
            awaiting_first_stream: true,
        })
    }

    fn run(&mut self, receiver: Receiver<Command>) {
        self.publish();
        loop {
            match receiver.recv_timeout(Duration::from_millis(20)) {
                Ok(Command::Shutdown) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Ok(command) => {
                    if let Err(error) = self.command(command) {
                        self.state.error = Some(error);
                        self.publish();
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            // Drain a bounded number of messages so control commands stay responsive.
            for _ in 0..32 {
                let Some(message) = self.bus.pop() else {
                    break;
                };
                self.message(&message);
            }
            for _ in 0..8 {
                let Some(message) = self.monitor.bus().pop() else {
                    break;
                };
                if let gst::MessageView::DeviceRemoved(_) = message.view() {
                    if self
                        .state
                        .device_id
                        .as_ref()
                        .is_some_and(|id| !self.devices().iter().any(|(info, _)| &info.id == id))
                    {
                        if let Err(error) = self.select_device(None) {
                            self.state.error = Some(error);
                            self.publish();
                        }
                    }
                }
            }
            if self.last_tick.elapsed() >= Duration::from_millis(250) {
                self.tick();
                self.last_tick = Instant::now();
            }
            if self.last_save.elapsed() >= Duration::from_secs(5) {
                if let Err(e) = self.store.save_player(&self.state) {
                    self.state.error = Some(format!("播放记录保存失败：{e}"));
                    self.publish();
                }
                self.last_save = Instant::now();
            }
        }
        self.cancel_jobs();
        let _ = self.store.save_player(&self.state);
        let _ = self.playbin.set_state(gst::State::Null);
        self.monitor.stop();
    }

    fn command(&mut self, command: Command) -> AppResult<()> {
        match command {
            Command::Queue(queue, index) => {
                if queue.is_empty() || queue.len() > 1000 || index >= queue.len() {
                    return Err("播放队列无效，最多支持 1000 首歌曲".into());
                }
                self.state.queue = queue;
                self.load(index, true)?;
            }
            Command::PlayNext(tracks) => {
                if tracks.is_empty() {
                    return Ok(());
                }
                let position = self.state.insert_next(tracks)?;
                if let Some(job) = self.next_job.take() {
                    job.abort();
                }
                // Hold the prepared lock while clearing armed state so the streaming
                // callback cannot arm the old next track between these operations.
                let transitioning = {
                    let mut prepared = self.prepared.lock().map_err(|_| "预加载状态不可用")?;
                    *prepared = None;
                    self.armed
                        .lock()
                        .map_err(|_| "预加载状态不可用")?
                        .take()
                        .is_some()
                };
                self.next_attempt = None;
                self.next_attempts = 0;
                if transitioning {
                    // The old URI was already handed to GStreamer at the boundary.
                    // Start the newly requested next track through the normal loader.
                    self.load(position, self.desired_playing)?;
                }
                self.publish();
            }
            Command::Remove(index, key) => {
                let removed_current = self.state.remove_track(index, &key)?;
                let loading = self.state.status == PlaybackStatus::Loading;
                // Use the same lock order as the streaming callback, so it cannot
                // arm a removed next track between checking and invalidating it.
                let transitioning = {
                    let mut prepared = self.prepared.lock().map_err(|_| "预加载状态不可用")?;
                    *prepared = None;
                    self.armed
                        .lock()
                        .map_err(|_| "预加载状态不可用")?
                        .take()
                        .is_some()
                };
                self.cancel_jobs();
                if self.state.queue.is_empty() {
                    self.command(Command::Clear)?;
                } else if let Some(current) = self.state.index {
                    if removed_current || loading || transitioning {
                        self.load(current, self.desired_playing)?;
                    } else {
                        self.publish();
                    }
                } else {
                    self.publish();
                }
            }
            Command::Jump(index) => self.load(index, true)?,
            Command::Repeat => {
                self.state.repeat_mode = match self.state.repeat_mode {
                    RepeatMode::Off => RepeatMode::All,
                    RepeatMode::All => RepeatMode::One,
                    RepeatMode::One => RepeatMode::Off,
                };
                if let Some(job) = self.next_job.take() {
                    job.abort();
                }
                *self.prepared.lock().map_err(|_| "预加载状态不可用")? = None;
                *self.armed.lock().map_err(|_| "预加载状态不可用")? = None;
                self.next_attempt = None;
                self.next_attempts = 0;
                self.publish();
            }
            Command::Next => {
                if let Some(index) = following_index(
                    self.state.index,
                    self.state.queue.len(),
                    if self.state.repeat_mode == RepeatMode::One {
                        RepeatMode::All
                    } else {
                        self.state.repeat_mode
                    },
                ) {
                    self.load(index, true)?;
                }
            }
            Command::Previous => {
                if self.state.position_ms > 3000 {
                    self.seek(0)?;
                } else if let Some(index) = self.state.index.and_then(|i| i.checked_sub(1)) {
                    self.load(index, true)?;
                } else if self.state.index == Some(0) && self.state.repeat_mode != RepeatMode::Off {
                    self.load(self.state.queue.len() - 1, true)?;
                }
            }
            Command::Pause => {
                self.desired_playing = false;
                self.playbin
                    .set_state(gst::State::Paused)
                    .map_err(|e| e.to_string())?;
                self.state.status = PlaybackStatus::Paused;
                self.publish();
            }
            Command::Resume => {
                if self.state.current().is_some() {
                    if matches!(
                        self.state.status,
                        PlaybackStatus::Stopped | PlaybackStatus::Error
                    ) {
                        self.load(self.state.index.unwrap_or(0), true)?;
                    } else {
                        self.desired_playing = true;
                        self.playbin
                            .set_state(gst::State::Playing)
                            .map_err(|e| e.to_string())?;
                    }
                }
            }
            Command::Stop | Command::Clear => {
                let clear = matches!(command, Command::Clear);
                self.cancel_jobs();
                self.desired_playing = false;
                self.playbin
                    .set_state(gst::State::Null)
                    .map_err(|e| e.to_string())?;
                if clear {
                    self.state.queue.clear();
                    self.state.index = None;
                    self.state.duration_ms = 0;
                    self.state.actual_quality = None;
                    self.state.media_error = None;
                    self.state.revision += 1;
                }
                self.state.status = PlaybackStatus::Stopped;
                self.state.position_ms = 0;
                self.state.error = None;
                self.publish();
            }
            Command::Seek(ms) => self.seek(ms)?,
            Command::Volume(value) => {
                if !value.is_finite() || !(0.0..=1.0).contains(&value) {
                    return Err("音量必须介于 0 和 1".into());
                }
                self.playbin.set_property("volume", value);
                self.state.volume = value;
                self.publish();
            }
            Command::Device(id) => self.select_device(id)?,
            Command::Resolved {
                generation,
                index,
                key,
                result,
                next,
            } => {
                if generation != self.generation.load(Ordering::Acquire) {
                    return Ok(());
                }
                if next {
                    if following_index(
                        self.state.index,
                        self.state.queue.len(),
                        self.state.repeat_mode,
                    ) != Some(index)
                        || self
                            .state
                            .queue
                            .get(index)
                            .is_none_or(|track| track.key != key)
                    {
                        return Ok(());
                    }
                    self.next_job = None;
                    if let Ok(resolved) = *result {
                        *self.prepared.lock().map_err(|_| "预加载状态不可用")? = Some(Prepared {
                            generation,
                            index,
                            resolved,
                        });
                    }
                } else {
                    self.current_job = None;
                    match *result {
                        Ok(resolved) => {
                            self.state.actual_quality = resolved.quality;
                            crate::audio::start_stream(
                                &self.playbin,
                                &resolved.uri,
                                self.state.volume,
                                if self.desired_playing && self.pending_seek.is_none() {
                                    gst::State::Playing
                                } else {
                                    gst::State::Paused
                                },
                            )
                            .map_err(|e| e.to_string())?;
                        }
                        Err(error) => {
                            self.state.status = PlaybackStatus::Error;
                            self.state.error = Some(error);
                            self.desired_playing = false;
                            self.publish();
                        }
                    }
                }
            }
            Command::Devices(reply) => {
                let _ = reply.send(Ok(self
                    .devices()
                    .into_iter()
                    .map(|(info, _)| info)
                    .collect()));
            }
            Command::Shutdown => {}
        }
        Ok(())
    }

    fn load(&mut self, index: usize, playing: bool) -> AppResult<()> {
        let track = self
            .state
            .queue
            .get(index)
            .cloned()
            .ok_or("歌曲不在播放队列中")?;
        self.cancel_jobs();
        self.playbin
            .set_state(gst::State::Null)
            .map_err(|e| e.to_string())?;
        self.state.revision += 1;
        self.state.index = Some(index);
        self.state.position_ms = 0;
        self.state.duration_ms = track.duration_ms;
        self.state.actual_quality = None;
        self.state.error = None;
        self.pending_seek = None;
        self.awaiting_first_stream = true;
        self.state.status = PlaybackStatus::Loading;
        self.desired_playing = playing;
        self.resolve(index, track, false);
        self.publish();
        Ok(())
    }

    fn resolve(&mut self, index: usize, track: Track, next: bool) {
        let generation = self.generation.load(Ordering::Acquire);
        let netease = self.netease.clone();
        let sender = self.sender.clone();
        let quality = self
            .store
            .setting("quality")
            .ok()
            .flatten()
            .unwrap_or_else(|| "exhigh".into());
        let downgrade = self
            .store
            .setting("allowDowngrade")
            .ok()
            .flatten()
            .as_deref()
            != Some("false");
        let task = tauri::async_runtime::spawn(async move {
            let key = track.key.clone();
            let result = netease.resolve(track, &quality, downgrade).await;
            // Bounded channel delivery is performed off the audio thread.
            let _ = tauri::async_runtime::spawn_blocking(move || {
                sender.send(Command::Resolved {
                    generation,
                    index,
                    key,
                    result: Box::new(result),
                    next,
                })
            })
            .await;
        });
        if next {
            self.next_job = Some(task);
        } else {
            self.current_job = Some(task);
        }
    }

    fn cancel_jobs(&mut self) {
        self.generation.fetch_add(1, Ordering::AcqRel);
        if let Some(job) = self.current_job.take() {
            job.abort();
        }
        if let Some(job) = self.next_job.take() {
            job.abort();
        }
        if let Ok(mut slot) = self.prepared.lock() {
            *slot = None;
        }
        if let Ok(mut slot) = self.armed.lock() {
            *slot = None;
        }
        self.next_attempt = None;
        self.next_attempts = 0;
    }

    fn seek(&mut self, ms: u64) -> AppResult<()> {
        if self.state.current().is_none() || self.state.duration_ms == 0 {
            return Err("当前歌曲尚不可定位".into());
        }
        let ms = ms.min(self.state.duration_ms);
        self.playbin
            .seek_simple(
                gst::SeekFlags::FLUSH | gst::SeekFlags::ACCURATE,
                gst::ClockTime::from_mseconds(ms),
            )
            .map_err(|_| "当前资源不支持定位")?;
        self.state.position_ms = ms;
        self.publish();
        Ok(())
    }

    fn message(&mut self, message: &gst::MessageRef) {
        use gst::MessageView;
        match message.view() {
            MessageView::AsyncDone(_) => {
                if let Some(position) = self.pending_seek.take() {
                    if let Err(error) = self.seek(position) {
                        self.state.error = Some(error);
                    }
                    if self.desired_playing {
                        let _ = self.playbin.set_state(gst::State::Playing);
                    }
                }
            }
            MessageView::StreamStart(_) => {
                if self.awaiting_first_stream {
                    self.awaiting_first_stream = false;
                    self.publish();
                    return;
                }
                let armed = self.armed.lock().ok().and_then(|mut slot| slot.take());
                if let Some(next) =
                    armed.filter(|p| p.generation == self.generation.load(Ordering::Acquire))
                {
                    self.cancel_jobs();
                    self.state.revision += 1;
                    self.state.index = Some(next.index);
                    self.state.position_ms = 0;
                    self.state.duration_ms = next.resolved.track.duration_ms;
                    self.state.actual_quality = next.resolved.quality;
                }
                self.publish();
            }
            MessageView::StateChanged(change)
                if message.src().is_some_and(|s| s == &self.playbin)
                    && self.current_job.is_none() =>
            {
                let status = match change.current() {
                    gst::State::Playing => Some(PlaybackStatus::Playing),
                    gst::State::Paused if !self.desired_playing => Some(PlaybackStatus::Paused),
                    _ => None,
                };
                if let Some(status) = status {
                    if self.state.status != status {
                        self.state.status = status;
                        self.publish();
                    }
                }
            }
            MessageView::Buffering(value) if self.desired_playing => {
                match crate::audio::update_buffering(&self.playbin, value.percent()) {
                    Ok(status) => self.state.status = status,
                    Err(error) => self.state.error = Some(error.to_string()),
                }
                self.publish();
            }
            MessageView::DurationChanged(_) => {
                self.state.duration_ms = self
                    .playbin
                    .query_duration::<gst::ClockTime>()
                    .map_or(self.state.duration_ms, |t| t.mseconds());
            }
            MessageView::Eos(_) => {
                if let Some(index) = following_index(
                    self.state.index,
                    self.state.queue.len(),
                    self.state.repeat_mode,
                ) {
                    if let Err(error) = self.load(index, true) {
                        self.state.error = Some(error);
                        self.state.status = PlaybackStatus::Error;
                        self.publish();
                    }
                } else {
                    self.desired_playing = false;
                    self.state.status = PlaybackStatus::Stopped;
                    self.state.position_ms = self.state.duration_ms;
                    let _ = self.playbin.set_state(gst::State::Null);
                    self.publish();
                }
            }
            MessageView::Error(error) => {
                self.cancel_jobs();
                self.desired_playing = false;
                self.state.status = PlaybackStatus::Error;
                self.state.error = Some(format!("音频播放失败：{}", error.error()));
                let _ = self.playbin.set_state(gst::State::Null);
                self.publish();
            }
            _ => {}
        }
    }

    fn tick(&mut self) {
        if matches!(
            self.state.status,
            PlaybackStatus::Playing
                | PlaybackStatus::Paused
                | PlaybackStatus::Buffering
                | PlaybackStatus::Loading
        ) {
            self.state.position_ms = self
                .playbin
                .query_position::<gst::ClockTime>()
                .map_or(self.state.position_ms, |t| t.mseconds());
            self.state.duration_ms = self
                .playbin
                .query_duration::<gst::ClockTime>()
                .map_or(self.state.duration_ms, |t| t.mseconds());
            if let Ok(mut shared) = self.shared.write() {
                shared.position_ms = self.state.position_ms;
                shared.duration_ms = self.state.duration_ms;
            }
            self.update_media();
            let _ = self.app.emit(
                "player-progress",
                Progress {
                    revision: self.state.revision,
                    position_ms: self.state.position_ms,
                    duration_ms: self.state.duration_ms,
                    status: self.state.status,
                },
            );
            if self.state.status == PlaybackStatus::Playing
                && self
                    .state
                    .duration_ms
                    .saturating_sub(self.state.position_ms)
                    <= 30_000
                && self.next_job.is_none()
                && self.next_attempts < 3
                && self
                    .next_attempt
                    .is_none_or(|t| t.elapsed() > Duration::from_secs(5))
            {
                let ready = self.prepared.lock().map(|p| p.is_some()).unwrap_or(false)
                    || self.armed.lock().map(|p| p.is_some()).unwrap_or(false);
                if !ready {
                    if let Some(index) = following_index(
                        self.state.index,
                        self.state.queue.len(),
                        self.state.repeat_mode,
                    ) {
                        self.next_attempt = Some(Instant::now());
                        self.next_attempts += 1;
                        self.resolve(index, self.state.queue[index].clone(), true);
                    }
                }
            }
        }
    }

    fn publish(&mut self) {
        self.update_media();
        if let Ok(mut shared) = self.shared.write() {
            *shared = self.state.clone();
        }
        let _ = self.app.emit("player-state", self.state.clone());
    }

    fn update_media(&mut self) {
        if let Some(media) = &mut self.media {
            if let Err(error) = media.update(&self.state) {
                self.state.media_error = Some(format!("系统媒体信息同步失败：{error}"));
            }
        }
    }

    fn devices(&self) -> Vec<(OutputDevice, gst::Device)> {
        self.monitor
            .devices()
            .into_iter()
            .map(|device| {
                let identity = format!(
                    "{}:{}",
                    device.device_class(),
                    device
                        .properties()
                        .map_or_else(|| device.display_name().to_string(), |s| s.to_string())
                );
                (
                    OutputDevice {
                        id: format!("{:x}", Sha256::digest(identity.as_bytes())),
                        name: device.display_name().to_string(),
                    },
                    device,
                )
            })
            .collect()
    }

    fn select_device(&mut self, id: Option<String>) -> AppResult<()> {
        let sink = match &id {
            Some(id) => self
                .devices()
                .into_iter()
                .find(|(info, _)| &info.id == id)
                .ok_or("该设备已断开，请选择其他设备")?
                .1
                .create_element(Some("nons-output"))
                .map_err(|e| e.to_string())?,
            None => gst::ElementFactory::make("autoaudiosink")
                .build()
                .map_err(|e| e.to_string())?,
        };
        let playing = self.desired_playing;
        let index = self.state.index;
        let position = self.state.position_ms;
        self.cancel_jobs();
        self.playbin
            .set_state(gst::State::Null)
            .map_err(|e| e.to_string())?;
        self.playbin.set_property("audio-sink", sink);
        self.state.device_id = id;
        // Device changes restart the pipeline. The normal resolver and state
        // messages remain the sole source of truth; never promise gapless here.
        if let Some(index) = index {
            self.load(index, playing)?;
        } else {
            self.publish();
        }
        if index.is_some() && position > 0 {
            self.pending_seek = Some(position);
        }
        Ok(())
    }
}
