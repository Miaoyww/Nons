//! QQ search protocol adapted from Lyricify-Lyrics-Helper (Apache-2.0).
//! Metadata policy ported from AF-Media-Bar (MIT). See notices/.
use crate::{
    model::{AppResult, Lyrics, Track},
    storage::MAX_LYRIC_BYTES,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use quick_xml::{events::Event, Reader};
use regex::Regex;
use serde_json::{json, Value};
use std::{sync::LazyLock, time::Duration};

pub const MINIMUM_SCORE: u32 = 80;

#[derive(Debug)]
struct Candidate {
    id: Option<u64>,
    mid: String,
    title: String,
    artists: Vec<String>,
    album: String,
    duration: f64,
}

pub async fn lookup(
    client: &reqwest::Client,
    track: &Track,
    skip_qrc: bool,
) -> AppResult<Option<Lyrics>> {
    // A single bounded stage; timeout and transport errors must remain retryable.
    tokio::time::timeout(
        Duration::from_secs(3),
        lookup_inner(client, track, skip_qrc),
    )
    .await
    .map_err(|_| "QQ 歌词查询超时".to_string())?
}

async fn lookup_inner(
    client: &reqwest::Client,
    track: &Track,
    skip_qrc: bool,
) -> AppResult<Option<Lyrics>> {
    if track.title.trim().is_empty() || track.artist.trim().is_empty() {
        return Ok(None);
    }
    if [&track.title, &track.artist, &track.album]
        .iter()
        .any(|s| s.len() > 1024)
    {
        return Err("QQ 匹配元数据过长".into());
    }
    let mut best: Option<(Candidate, u32)> = None;
    let mut failed = false;
    for query in queries(track).into_iter().take(3) {
        let request = client.post("https://u.y.qq.com/cgi-bin/musicu.fcg")
            .header("Referer", "https://c.y.qq.com/")
            .json(&json!({"req_1": {"method": "DoSearchForQQMusicDesktop", "module": "music.search.SearchCgiService",
                "param": {"num_per_page": "20", "page_num": "1", "query": query, "search_type": 0}}}));
        let response = match read_json(request).await.and_then(candidates) {
            Ok(value) => value,
            Err(_) => {
                failed = true;
                continue;
            }
        };
        for candidate in response {
            let score = metadata_score(track, &candidate);
            if best.as_ref().is_none_or(|(_, previous)| score > *previous) {
                best = Some((candidate, score));
            }
        }
        if best
            .as_ref()
            .is_some_and(|(_, score)| *score >= MINIMUM_SCORE)
        {
            break;
        }
    }
    let Some((candidate, _)) = best.filter(|(_, score)| *score >= MINIMUM_SCORE) else {
        return if failed {
            Err("QQ 歌曲搜索失败".into())
        } else {
            Ok(None)
        };
    };
    if let Some(id) = candidate.id.filter(|_| !skip_qrc) {
        // Reserve time for the legacy LRC request within the shared 3-second budget.
        let request = client
            .post("https://c.y.qq.com/qqmusic/fcgi-bin/lyric_download.fcg")
            .header("Referer", "https://c.y.qq.com/")
            .form(&[
                ("version", "15"),
                ("miniversion", "82"),
                ("lrctype", "4"),
                ("musicid", &id.to_string()),
            ]);
        let qrc = async {
            let response = read_text(request).await?;
            tauri::async_runtime::spawn_blocking(move || decode_qrc_response(&response))
                .await
                .map_err(|e| e.to_string())?
        };
        if let Ok(Ok(Some(lyrics))) = tokio::time::timeout(Duration::from_millis(900), qrc).await {
            return Ok(Some(lyrics));
        }
    }
    // QRC missing, damaged or unavailable: keep the matched song's legacy LRC.
    let request = client
        .get("https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg")
        .header("Referer", "https://c.y.qq.com/")
        .query(&[
            ("songmid", candidate.mid.as_str()),
            ("g_tk", "5381"),
            ("format", "json"),
            ("inCharset", "utf8"),
            ("outCharset", "utf-8"),
            ("platform", "yqq"),
            ("needNewCode", "0"),
            ("loginUin", "0"),
            ("hostUin", "0"),
        ]);
    decode_lyrics(read_json(request).await?)
}

async fn read_json(request: reqwest::RequestBuilder) -> AppResult<Value> {
    serde_json::from_str(&read_text(request).await?).map_err(|e| e.to_string())
}

async fn read_text(request: reqwest::RequestBuilder) -> AppResult<String> {
    let mut response = request
        .timeout(Duration::from_millis(1400))
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(|e| e.to_string())?;
    if response
        .content_length()
        .is_some_and(|n| n > MAX_LYRIC_BYTES as u64)
    {
        return Err("QQ 响应过大".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > MAX_LYRIC_BYTES {
            return Err("QQ 响应过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

fn candidates(value: Value) -> AppResult<Vec<Candidate>> {
    if value["code"].as_i64() != Some(0) || value["req_1"]["code"].as_i64() != Some(0) {
        return Err("QQ 搜索返回错误".into());
    }
    let list = value
        .pointer("/req_1/data/body/song/list")
        .and_then(Value::as_array)
        .ok_or("QQ 搜索响应无效")?;
    let mut result = Vec::new();
    for track in list.iter().take(20) {
        for entry in
            std::iter::once(track).chain(track["grp"].as_array().into_iter().flatten().take(20))
        {
            if entry["title"].as_str().is_some_and(|s| s.len() > 1024)
                || entry["album"]["title"]
                    .as_str()
                    .is_some_and(|s| s.len() > 1024)
                || entry["singer"].as_array().is_some_and(|artists| {
                    artists.len() > 32
                        || artists
                            .iter()
                            .any(|a| a["name"].as_str().is_some_and(|s| s.len() > 1024))
                })
            {
                return Err("QQ 搜索元数据过长".into());
            }
            if let Some(mid) = entry["mid"]
                .as_str()
                .filter(|s| !s.is_empty() && s.len() <= 128)
            {
                result.push(Candidate {
                    id: entry["id"].as_u64().filter(|id| *id > 0),
                    mid: mid.into(),
                    title: entry["title"].as_str().unwrap_or_default().into(),
                    artists: entry["singer"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|a| a["name"].as_str().map(str::to_owned))
                        .collect(),
                    album: entry["album"]["title"].as_str().unwrap_or_default().into(),
                    duration: entry["interval"].as_f64().unwrap_or_default(),
                });
            }
        }
    }
    Ok(result)
}

fn decode_qrc_response(response: &str) -> AppResult<Option<Lyrics>> {
    let response = response
        .trim()
        .trim_start_matches("<!--")
        .trim_end_matches("-->")
        .trim();
    let mut reader = Reader::from_str(response);
    let mut field = None;
    let mut original = String::new();
    let mut translation = String::new();
    let mut romanization = String::new();
    loop {
        match reader.read_event().map_err(|_| "QQ QRC 响应 XML 无效")? {
            Event::Start(e) => {
                field = match e.local_name().as_ref() {
                    b"content" => Some(0),
                    b"contentts" => Some(1),
                    b"contentroma" => Some(2),
                    _ => None,
                };
            }
            Event::CData(e) => {
                if let Some(field) = field {
                    let text = e.decode().map_err(|_| "QQ QRC 字段编码无效")?;
                    match field {
                        0 => original.push_str(&text),
                        1 => translation.push_str(&text),
                        _ => romanization.push_str(&text),
                    }
                }
            }
            Event::Text(e) => {
                if let Some(field) = field {
                    let text = e.xml_content().map_err(|_| "QQ QRC 字段编码无效")?;
                    match field {
                        0 => original.push_str(&text),
                        1 => translation.push_str(&text),
                        _ => romanization.push_str(&text),
                    }
                }
            }
            Event::End(_) => field = None,
            Event::DocType(_) => return Err("QQ QRC 不支持 DTD".into()),
            Event::Eof => break,
            _ => {}
        }
    }
    if original.trim().is_empty() {
        return Ok(None);
    }
    let content = decode_qrc_field(&original)?;
    static WORDS: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"(?m)^\[\d+,\d+\].+\(\d+,\d+\)").unwrap());
    if !WORDS.is_match(&content) {
        return Err("QQ QRC 缺少逐词时间轴".into());
    }
    // Auxiliary failures must not discard usable word-level lyrics.
    let auxiliary = |text: &str| {
        (!text.trim().is_empty())
            .then(|| decode_qrc_field(text).ok())
            .flatten()
    };
    let translation = auxiliary(&translation);
    let romanization = auxiliary(&romanization);
    if content.len()
        + translation.as_ref().map_or(0, String::len)
        + romanization.as_ref().map_or(0, String::len)
        > MAX_LYRIC_BYTES
    {
        return Err("QQ QRC 正文与附加歌词过大".into());
    }
    Ok(Some(Lyrics {
        source: "qq".into(),
        format: "qrc".into(),
        content,
        translation,
        romanization,
    }))
}

fn decode_qrc_field(text: &str) -> AppResult<String> {
    // Some lyric_download fields contain plaintext LRC rather than ciphertext.
    let text = if text.trim_start().starts_with('[') {
        text.to_owned()
    } else {
        crate::qrc_decrypt::decrypt(text)?
    };
    if !text.trim_start().starts_with('<') {
        return Ok(text);
    }
    let mut reader = Reader::from_str(&text);
    let mut content = None;
    loop {
        match reader.read_event().map_err(|_| "QRC 正文 XML 无效")? {
            Event::Start(e) | Event::Empty(e) if e.local_name().as_ref() == b"Lyric_1" => {
                for attribute in e.attributes() {
                    let attribute = attribute.map_err(|_| "QRC 正文属性无效")?;
                    if attribute.key.as_ref() == b"LyricContent" {
                        content = Some(
                            attribute
                                .decode_and_unescape_value(reader.decoder())
                                .map_err(|_| "QRC 正文编码无效")?
                                .into_owned(),
                        );
                    }
                }
            }
            Event::DocType(_) => return Err("QRC 正文不支持 DTD".into()),
            Event::Eof => return content.ok_or_else(|| "QRC 缺少 LyricContent".into()),
            _ => {}
        }
    }
}

fn decode_lyrics(value: Value) -> AppResult<Option<Lyrics>> {
    if value["code"].as_i64() != Some(0) {
        return Err("QQ 歌词返回错误".into());
    }
    if !value["lyric"].is_string() {
        return Err("QQ 歌词响应无效".into());
    }
    let decode = |field: &str| -> AppResult<Option<String>> {
        let Some(text) = value[field].as_str().filter(|s| !s.trim().is_empty()) else {
            return Ok(None);
        };
        let bytes = STANDARD.decode(text).map_err(|_| "QQ 歌词编码无效")?;
        let text = String::from_utf8(bytes).map_err(|_| "QQ 歌词编码无效")?;
        Ok((!text.trim().is_empty()).then_some(text))
    };
    let Some(content) = decode("lyric")? else {
        return Ok(None);
    };
    static TIMED: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"\[\d+:\d{2}(?:[.:]\d+)?\][^\r\n]*\S").unwrap());
    if !TIMED.is_match(&content) {
        return Err("QQ 歌词缺少有效时间轴".into());
    }
    Ok(Some(Lyrics {
        source: "qq".into(),
        format: "lrc".into(),
        content,
        translation: decode("trans")?,
        romanization: decode("roma")?,
    }))
}

fn artists(text: &str) -> Vec<&str> {
    // Nons joins structured NetEase artists with this exact literal separator.
    let result: Vec<_> = text
        .split(" / ")
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    if result.is_empty() {
        vec![""]
    } else {
        result
    }
}

fn without_translation(text: &str) -> String {
    static SUFFIX: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"\s*[（(][^（）()]*[\x{4e00}-\x{9fff}][^（）()]*[）)]\s*$").unwrap()
    });
    static VERSION: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(
            r"(?i)现场|現場|伴奏|翻唱|混音|重制|重製|倍速|live|remix|cover|acoustic|instrumental",
        )
        .unwrap()
    });
    if let Some(suffix) = SUFFIX.find(text) {
        if !VERSION.is_match(suffix.as_str()) {
            return text[..suffix.start()].trim().into();
        }
    }
    text.trim().into()
}

fn queries(track: &Track) -> Vec<String> {
    let title = without_translation(&track.title);
    let artist = artists(&track.artist)
        .into_iter()
        .map(without_translation)
        .collect::<Vec<_>>()
        .join(" ");
    let mut result = Vec::new();
    for query in [
        format!("{title} {artist}"),
        format!("{} {}", track.title, track.artist),
    ]
    .into_iter()
    .chain(
        artists(&track.artist)
            .into_iter()
            .map(|a| format!("{title} {}", without_translation(a))),
    )
    .chain(std::iter::once(title.clone()))
    {
        let query = query.trim().to_owned();
        if !query.is_empty() && !result.contains(&query) {
            result.push(query);
        }
    }
    result
}

fn compare(left: &str, right: &str) -> f64 {
    let left = left.trim().to_lowercase();
    let right = right.trim().to_lowercase();
    if left.is_empty() && right.is_empty() {
        return 1.0;
    }
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    similarity(&left, &right)
}

fn fingerprint(text: &str) -> String {
    static NON_WORD: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"[\p{P}\p{S}]").unwrap());
    let text = NON_WORD.replace_all(&text.to_lowercase(), " ").into_owned();
    let mut tokens: Vec<_> = text.split(' ').filter(|s| !s.is_empty()).collect();
    tokens.sort_by_key(|s| s.encode_utf16().collect::<Vec<_>>());
    tokens.join(" ")
}

fn metadata_score(track: &Track, candidate: &Candidate) -> u32 {
    let request_artists = artists(&track.artist);
    let candidate_artists: Vec<_> = candidate.artists.iter().flat_map(|a| artists(a)).collect();
    let total = if track.title.trim().is_empty() || candidate.title.trim().is_empty() {
        request_artists
            .iter()
            .flat_map(|a| {
                candidate_artists.iter().map(move |b| {
                    let left = fingerprint(&format!("{} {a}", track.title));
                    let right = fingerprint(&format!("{} {b}", candidate.title));
                    if left.is_empty() || right.is_empty() {
                        0.0
                    } else {
                        similarity(&left, &right)
                    }
                })
            })
            .fold(0.0, f64::max)
    } else {
        let artist = request_artists
            .iter()
            .flat_map(|a| candidate_artists.iter().map(move |b| compare(a, b)))
            .fold(0.0, f64::max);
        let local = track.duration_ms as f64 / 1000.0;
        let remote = candidate.duration;
        let duration = if local <= 0.0 || remote <= 0.0 || !remote.is_finite() {
            0.0
        } else {
            (1.0 - ((local - remote).abs() - 1.0).max(0.0) / 9.0).max(0.0)
        };
        0.4 * compare(&track.title, &candidate.title)
            + 0.4 * artist
            + 0.1 * compare(&track.album, &candidate.album)
            + 0.1 * duration
    };
    (100.0 * total).round_ties_even() as u32
}

// Faithful F23.StringSimilarity JaroWinkler port: UTF-16, uncapped prefix,
// length-dependent bonus, integer half-transpositions and f32 Jaro arithmetic.
// Copyright 2016 feature[23], MIT; see notices/F23-StringSimilarity-LICENSE.txt.
fn similarity(left: &str, right: &str) -> f64 {
    let a: Vec<_> = left.encode_utf16().collect();
    let b: Vec<_> = right.encode_utf16().collect();
    if a == b {
        return 1.0;
    }
    let (max, min) = if a.len() > b.len() {
        (&a, &b)
    } else {
        (&b, &a)
    };
    let range = (max.len() / 2).saturating_sub(1);
    let mut indexes = vec![None; min.len()];
    let mut flags = vec![false; max.len()];
    for (i, character) in min.iter().enumerate() {
        for j in i.saturating_sub(range)..(i + range + 1).min(max.len()) {
            if !flags[j] && *character == max[j] {
                indexes[i] = Some(j);
                flags[j] = true;
                break;
            }
        }
    }
    let first: Vec<_> = min
        .iter()
        .zip(indexes)
        .filter_map(|(c, i)| i.map(|_| c))
        .collect();
    if first.is_empty() {
        return 0.0;
    }
    let second: Vec<_> = max
        .iter()
        .zip(flags)
        .filter_map(|(c, f)| f.then_some(c))
        .collect();
    let half = first.iter().zip(second).filter(|(a, b)| *a != b).count() / 2;
    let m = first.len() as f32;
    let jaro = ((m / a.len() as f32 + m / b.len() as f32 + (m - half as f32) / m) as f64) / 3.0;
    if jaro > 0.7 {
        let prefix = a.iter().zip(&b).take_while(|(a, b)| a == b).count();
        jaro + 0.1f64.min(1.0 / max.len() as f64) * prefix as f64 * (1.0 - jaro)
    } else {
        jaro
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::TrackSource;
    #[test]
    fn encrypted_qrc_xml_auxiliary_fields_and_failures() {
        // Ciphertext generated by AMLL encryptQrcHex from original synthetic text.
        let fixture: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/qrc.json")).unwrap();
        let response = format!("<!--<response><content><![CDATA[{}]]></content><contentts><![CDATA[{}]]></contentts><contentroma><![CDATA[{}]]></contentroma></response>-->",
            fixture["encrypted"].as_str().unwrap(), fixture["translation"].as_str().unwrap(), fixture["romanization"].as_str().unwrap());
        let result = decode_qrc_response(&response).unwrap().unwrap();
        assert_eq!(result.format, "qrc");
        assert_eq!(result.content, fixture["main"].as_str().unwrap());
        assert_eq!(
            result.translation.as_deref(),
            Some("[00:01.00]你好世界\n[00:03.00]再次")
        );
        assert!(result.romanization.unwrap().contains("(1000,400)"));
        let bad_auxiliary = response.replace(fixture["translation"].as_str().unwrap(), "damaged");
        assert!(decode_qrc_response(&bad_auxiliary)
            .unwrap()
            .unwrap()
            .translation
            .is_none());
        assert!(decode_qrc_response("<response><content>not-hex</content></response>").is_err());
        assert!(decode_qrc_response("<response><content/></response>")
            .unwrap()
            .is_none());
        assert!(decode_qrc_field(fixture["oversized"].as_str().unwrap()).is_err());
        assert!(decode_qrc_field("0").is_err());
        assert!(decode_qrc_field("0000000000000000").is_err());
    }
    #[test]
    #[ignore = "requires the live QQ Music service"]
    fn live_qq_search_and_qrc_download() {
        let client = reqwest::Client::builder()
            .user_agent("NonsPlayer/0.1")
            .connect_timeout(Duration::from_millis(500))
            .build()
            .unwrap();
        let value = tauri::async_runtime::block_on(lookup(&client, &track(), false))
            .unwrap()
            .expect("晴天 should have matched QQ lyrics");
        assert_eq!(value.source, "qq");
        assert_eq!(value.format, "qrc");
        assert!(value.content.contains("["));
        println!("QQ live lookup: {} UTF-8 bytes", value.content.len());
        let lrc = tauri::async_runtime::block_on(lookup(&client, &track(), true))
            .unwrap()
            .unwrap();
        assert_eq!(lrc.format, "lrc");
    }
    fn track() -> Track {
        Track {
            key: "ncm:1".into(),
            title: "晴天".into(),
            aliases: vec![],
            artist: "周杰伦 / 杨瑞代".into(),
            album: "叶惠美".into(),
            duration_ms: 269000,
            cover: String::new(),
            source: TrackSource::Netease { id: 1 },
        }
    }
    fn candidate() -> Candidate {
        Candidate {
            id: Some(97773),
            mid: "abc".into(),
            title: "晴天".into(),
            artists: vec!["周杰伦".into()],
            album: "叶惠美".into(),
            duration: 269.0,
        }
    }
    #[test]
    fn score_preserves_weights_best_artist_and_preview_duration() {
        let mut c = candidate();
        assert_eq!(metadata_score(&track(), &c), 100);
        c.duration = 30.0;
        assert_eq!(metadata_score(&track(), &c), 90);
        c.artists = vec!["无关歌手".into()];
        assert!(metadata_score(&track(), &c) < MINIMUM_SCORE);
        c = candidate();
        c.duration = 274.5;
        assert_eq!(metadata_score(&track(), &c), 95);
    }
    #[test]
    fn f23_prefix_bonus_is_not_standard_winkler() {
        assert!((similarity("abcdefghijx", "abcdefghijy") - 0.9944903597687237).abs() < 0.000001);
        assert!((similarity("MARTHA", "MARHTA") - 0.9611110849380493).abs() < 0.000001);
        assert_eq!(compare(" 晴天 ", "晴天"), 1.0);
    }
    #[test]
    fn search_keeps_versions_and_includes_grouped_candidates() {
        assert_eq!(without_translation("Hello（你好）"), "Hello");
        assert_eq!(without_translation("Hello（现场版）"), "Hello（现场版）");
        let result = candidates(json!({"code":0,"req_1":{"code":0,"data":{"body":{"song":{"list":[{"mid":"a","title":"晴天","grp":[{"mid":"b","title":"晴天"}]}]}}}}})).unwrap();
        assert_eq!(result.len(), 2);
    }
    #[test]
    fn bad_responses_are_errors_not_permanent_misses() {
        assert!(candidates(json!({"code":0})).is_err());
        assert!(decode_lyrics(json!({"code":1})).is_err());
        assert!(decode_lyrics(json!({"code":0,"lyric":"not base64"})).is_err());
        assert!(
            decode_lyrics(json!({"code":0,"lyric":STANDARD.encode("<html>error</html>")})).is_err()
        );
        assert!(decode_lyrics(json!({"code":0,"lyric":""}))
            .unwrap()
            .is_none());
        let lyrics = decode_lyrics(json!({"code":0,"lyric":STANDARD.encode("[00:01.00]晴天"),"trans":STANDARD.encode("[00:01.00]Sunny day")})).unwrap().unwrap();
        assert_eq!(lyrics.source, "qq");
        assert_eq!(lyrics.translation.as_deref(), Some("[00:01.00]Sunny day"));
    }
}
