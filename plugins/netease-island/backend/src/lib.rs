mod bindings;
use bindings::{nons::plugin::host, Guest};
use serde_json::{json, Value};

struct Island;
impl Guest for Island {
    fn initialize() -> Result<(), String> { Ok(()) }
    fn shutdown() -> Result<(), String> { Ok(()) }
    fn call(method: String, args: String) -> Result<String, String> {
        if method != "event:music-link" { return Err("未知方法".into()); }
        let args: Value = serde_json::from_str(&args).map_err(|_| "无效参数")?;
        let Some(id) = args.get("url").and_then(Value::as_str).and_then(song_id) else { return Ok("null".into()); };
        // Network failures are recoverable and must not fault this plugin.
        if let Ok(song) = host::call("music.get-song", &json!({"id":id}).to_string()) {
            let payload: Value = serde_json::from_str(&song).map_err(|_| "无效歌曲信息")?;
            host::call("events.emit", &json!({"event":"song-detected","payload":payload}).to_string())?;
        }
        Ok("null".into())
    }
}
fn song_id(url: &str) -> Option<u64> {
    let (_, query) = url.split_once('?')?;
    query.split('&').find_map(|part| {
        let (key, value) = part.split_once('=')?;
        if key != "id" { return None; }
        let value = value.split('#').next()?;
        let id = value.parse::<u64>().ok()?;
        (id > 0 && id <= 9_007_199_254_740_991).then_some(id)
    })
}
bindings::export!(Island with_types_in bindings);

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn parses_normal_and_fragment_links() {
        assert_eq!(song_id("https://music.163.com/song?id=123&userid=2"), Some(123));
        assert_eq!(song_id("https://music.163.com/#/song?id=456"), Some(456));
        for url in ["https://music.163.com/song", "https://music.163.com/song?id=-1", "https://music.163.com/song?id=9007199254740992"] { assert_eq!(song_id(url), None); }
    }
}
