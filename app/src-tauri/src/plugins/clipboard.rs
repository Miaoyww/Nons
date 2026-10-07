use super::PluginManager;
use crate::model::AppResult;
use clipboard_rs::{Clipboard, ClipboardContext, ClipboardHandler};
#[cfg(not(windows))]
use clipboard_rs::{ClipboardWatcher, ClipboardWatcherContext};
use std::{
    sync::{Arc, LazyLock, Weak},
    time::Duration,
};
pub enum Shutdown {
    #[cfg(windows)]
    Windows(clipboard_win::monitor::Shutdown),
    #[cfg(not(windows))]
    Other(clipboard_rs::WatcherShutdown),
}
impl Shutdown {
    pub fn stop(self) {
        match self {
            #[cfg(windows)]
            Self::Windows(channel) => drop(channel),
            #[cfg(not(windows))]
            Self::Other(channel) => channel.stop(),
        }
    }
}

struct Handler {
    context: ClipboardContext,
    manager: Weak<PluginManager>,
}
impl ClipboardHandler for Handler {
    fn on_clipboard_change(&mut self) {
        let Some(manager) = self.manager.upgrade() else {
            return;
        };
        if !manager.has_clipboard_subscribers() {
            return;
        }
        let Ok(text) = self.context.get_text() else {
            return;
        };
        if text.len() > 16 * 1024 {
            return;
        }
        let urls = candidates(&text);
        if urls.is_empty() {
            return;
        }
        // Bounded coalescing: callbacks replace pending URLs instead of creating tasks.
        manager.clipboard_sender.send_replace(urls);
    }
}
#[cfg(windows)]
pub fn start(manager: &Arc<PluginManager>) -> AppResult<Shutdown> {
    let manager = Arc::downgrade(manager);
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    std::thread::Builder::new()
        .name("nons-plugin-clipboard".into())
        .spawn(move || {
            let result = (|| {
                let monitor = clipboard_win::Monitor::new().map_err(|e| e.to_string())?;
                let context = ClipboardContext::new().map_err(|e| e.to_string())?;
                Ok::<_, String>((monitor, Handler { context, manager }))
            })();
            match result {
                Ok((mut monitor, mut handler)) => {
                    if sender
                        .send(Ok(Shutdown::Windows(monitor.shutdown_channel())))
                        .is_err()
                    {
                        return;
                    }
                    while let Ok(true) = monitor.recv() {
                        handler.on_clipboard_change();
                    }
                }
                Err(error) => {
                    let _ = sender.send(Err(error));
                }
            }
        })
        .map_err(|e| e.to_string())?;
    receiver
        .recv_timeout(Duration::from_secs(2))
        .map_err(|_| "剪贴板监听初始化超时")?
}
#[cfg(not(windows))]
pub fn start(manager: &Arc<PluginManager>) -> AppResult<Shutdown> {
    let context = ClipboardContext::new().map_err(|e| format!("剪贴板不可用: {e}"))?;
    let mut watcher = ClipboardWatcherContext::new_with_interval(Duration::from_millis(500))
        .map_err(|e| e.to_string())?;
    let shutdown = watcher
        .add_handler(Handler {
            context,
            manager: Arc::downgrade(manager),
        })
        .get_shutdown_channel();
    std::thread::Builder::new()
        .name("nons-plugin-clipboard".into())
        .spawn(move || watcher.start_watch())
        .map_err(|e| e.to_string())?;
    Ok(Shutdown::Other(shutdown))
}
pub fn allowed(url: &url::Url) -> bool {
    matches!(url.scheme(), "https" | "http")
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && matches!(
            url.host_str(),
            Some("music.163.com" | "y.music.163.com" | "m.music.163.com" | "163cn.tv")
        )
}
pub fn candidates(text: &str) -> Vec<String> {
    // The raw text is never sent to guests, retained or logged.
    static RE: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r#"https?://[^\s<>\"'，。；）)]+"#).expect("constant URL expression")
    });
    RE.find_iter(text)
        .filter_map(|item| {
            let url = url::Url::parse(item.as_str()).ok()?;
            let share = matches!(url.host_str(), Some("163cn.tv" | "y.music.163.com"))
                || matches!(url.path(), "/song" | "/song/" | "/m/song")
                || url.fragment().is_some_and(|f| f.starts_with("/song?"));
            (allowed(&url) && share && url.as_str().len() <= 2048).then(|| url.to_string())
        })
        .take(4)
        .collect()
}
pub async fn resolve(candidate: &str, client: &reqwest::Client) -> AppResult<String> {
    let mut url = url::Url::parse(candidate).map_err(|_| "无效分享链接")?;
    for _ in 0..3 {
        if !allowed(&url) {
            return Err("分享链接跳转到非允许地址".into());
        }
        // Direct links need no network request. The guest recognizes the song ID.
        if direct(&url) {
            return Ok(url.to_string());
        }
        let response = client
            .get(url.clone())
            .send()
            .await
            .map_err(|_| "短链解析失败")?;
        if !response.status().is_redirection() {
            return Err("不支持的分享链接".into());
        }
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .ok_or("短链没有跳转地址")?;
        if location.len() > 2048 {
            return Err("分享链接过长".into());
        }
        url = url.join(location).map_err(|_| "无效跳转地址")?;
    }
    if allowed(&url) && direct(&url) {
        Ok(url.to_string())
    } else {
        Err("短链跳转次数过多".into())
    }
}
fn direct(url: &url::Url) -> bool {
    matches!(url.path(), "/song" | "/song/" | "/m/song")
        || url.fragment().is_some_and(|f| f.starts_with("/song?"))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn filters_text_and_lookalike_hosts() {
        let text = "私密内容 https://evil.test/music.163.com/song?id=1 https://music.163.com.evil.test/song?id=2 https://music.163.com/song?id=3";
        assert_eq!(candidates(text), ["https://music.163.com/song?id=3"]);
        assert!(candidates("https://user:pass@music.163.com/song?id=1").is_empty());
        assert!(!allowed(
            &url::Url::parse("https://127.0.0.1/song?id=1").unwrap()
        ));
    }
}
