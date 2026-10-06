use crate::model::{AppResult, Lyrics, ResolvedTrack, Track, TrackSource};
use base64::Engine;
use ncm_api_rs::{
    request::{ApiClient, ApiResponse},
    Query,
};
use serde::Serialize;
use serde_json::Value;
use std::{future::Future, sync::Mutex, time::Duration};

pub struct Netease {
    client: ApiClient,
    cookie: Mutex<Option<String>>,
    credential: keyring::Entry,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QrLogin {
    pub key: String,
    pub image: String,
}

#[derive(Serialize)]
pub struct LoginStatus {
    pub code: i64,
    pub message: String,
}

impl Netease {
    pub fn new() -> AppResult<Self> {
        let credential = keyring::Entry::new("NonsPlayer", "netease-session")
            .map_err(|_| "系统凭据存储不可用")?;
        let cookie = match credential.get_password() {
            Ok(cookie) => Some(cookie),
            Err(keyring::Error::NoEntry) => None,
            Err(_) => return Err("无法读取系统凭据存储，请检查系统钥匙串权限".into()),
        };
        Ok(Self {
            client: ncm_api_rs::create_client(None),
            cookie: Mutex::new(cookie),
            credential,
        })
    }

    fn query(&self) -> AppResult<Query> {
        let query = Query::new();
        Ok(
            match self.cookie.lock().map_err(|_| "登录状态锁不可用")?.as_ref() {
                Some(cookie) => query.cookie(cookie),
                None => query,
            },
        )
    }

    pub async fn search(&self, keyword: &str, offset: u32) -> AppResult<Vec<Track>> {
        if keyword.trim().is_empty() || keyword.len() > 256 {
            return Err("请输入不超过 256 字节的搜索词".into());
        }
        let query = self
            .query()?
            .param("keywords", keyword.trim())
            .param("type", "1")
            .param("limit", "50")
            .param("offset", &offset.to_string());
        let body = checked(self.client.cloudsearch(&query)).await?;
        let songs = body.pointer("/result/songs").and_then(Value::as_array);
        Ok(songs
            .into_iter()
            .flatten()
            .filter_map(track_from_json)
            .collect())
    }

    pub async fn resolve(
        &self,
        track: Track,
        quality: &str,
        allow_downgrade: bool,
    ) -> AppResult<ResolvedTrack> {
        if let TrackSource::Local { path, .. } = &track.source {
            let uri = url::Url::from_file_path(path)
                .map_err(|_| "本地文件路径无效")?
                .to_string();
            if !std::path::Path::new(path).is_file() {
                return Err("本地音乐文件已移动或删除，请重新导入".into());
            }
            return Ok(ResolvedTrack {
                track,
                uri,
                quality: None,
            });
        }
        let id = track.netease_id().ok_or("网易云歌曲 ID 缺失")?;
        let query = self
            .query()?
            .param("id", &id.to_string())
            .param("level", quality);
        let body = checked(self.client.song_url_v1(&query)).await?;
        let item = body.pointer("/data/0").ok_or("没有可用的播放资源")?;
        let uri = item
            .get("url")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .ok_or("此歌曲暂不可播放，请检查账号权限或音质设置")?;
        let parsed = url::Url::parse(uri).map_err(|_| "播放地址无效")?;
        if !matches!(parsed.scheme(), "https" | "http") {
            return Err("播放地址协议不支持".into());
        }
        let actual = item
            .get("level")
            .and_then(Value::as_str)
            .unwrap_or(quality)
            .to_string();
        if !allow_downgrade && actual != quality {
            return Err("所选音质不可用；可在音质设置中允许降级".into());
        }
        // Trial segments are not silently presented as complete tracks.
        if !item.get("freeTrialInfo").unwrap_or(&Value::Null).is_null() {
            return Err("当前账号只能试听此歌曲，暂不作为完整歌曲播放".into());
        }
        Ok(ResolvedTrack {
            track,
            uri: uri.into(),
            quality: Some(actual),
        })
    }

    pub async fn lyrics(&self, id: u64) -> AppResult<Option<Lyrics>> {
        let query = self.query()?.param("id", &id.to_string());
        let body = checked(self.client.lyric_new(&query)).await?;
        let word = body
            .pointer("/yrc/lyric")
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty());
        let line = body
            .pointer("/lrc/lyric")
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty());
        let Some(content) = word.or(line) else {
            return Ok(None);
        };
        if content.len() > crate::storage::MAX_LYRIC_BYTES {
            return Err("网易云歌词过大".into());
        }
        Ok(Some(Lyrics {
            source: "netease".into(),
            format: if word.is_some() { "yrc" } else { "lrc" }.into(),
            content: content.into(),
            translation: body
                .pointer(if word.is_some() {
                    "/ytlrc/lyric"
                } else {
                    "/tlyric/lyric"
                })
                .and_then(Value::as_str)
                .map(str::to_owned),
            romanization: body
                .pointer(if word.is_some() {
                    "/yromalrc/lyric"
                } else {
                    "/romalrc/lyric"
                })
                .and_then(Value::as_str)
                .map(str::to_owned),
        }))
    }

    pub async fn qr_login(&self) -> AppResult<QrLogin> {
        let query = self.query()?;
        let body = checked(self.client.login_qr_key(&query)).await?;
        let key = body
            .pointer("/data/unikey")
            .and_then(Value::as_str)
            .ok_or("无法生成登录二维码")?
            .to_string();
        let query = Query::new().param("key", &key);
        let body = checked(self.client.login_qr_create(&query)).await?;
        let url = body
            .pointer("/data/qrurl")
            .and_then(Value::as_str)
            .ok_or("二维码地址缺失")?;
        let qr = qrcode::QrCode::new(url).map_err(|_| "无法生成二维码图片")?;
        let svg = qr
            .render::<qrcode::render::svg::Color>()
            .min_dimensions(224, 224)
            .build();
        let image = format!(
            "data:image/svg+xml;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(svg)
        );
        Ok(QrLogin { key, image })
    }

    pub async fn poll_login(&self, key: &str) -> AppResult<LoginStatus> {
        if key.is_empty() || key.len() > 256 {
            return Err("登录二维码已失效，请重新生成".into());
        }
        let query = Query::new().param("key", key);
        let response = timed(self.client.login_qr_check(&query)).await?;
        let code = response
            .body
            .get("code")
            .and_then(Value::as_i64)
            .unwrap_or(response.status);
        if code == 803 {
            let mut tokens = std::collections::BTreeMap::new();
            for cookie in &response.cookie {
                if let Ok(cookie) = cookie::Cookie::parse(cookie.as_str()) {
                    if matches!(cookie.name(), "MUSIC_U" | "__csrf" | "MUSIC_A" | "NMTID") {
                        tokens.insert(cookie.name().to_string(), cookie.value().to_string());
                    }
                }
            }
            if !tokens.contains_key("MUSIC_U") {
                return Err("登录返回缺少有效会话，请重新扫码".into());
            }
            let value = tokens
                .into_iter()
                .map(|(k, v)| format!("{k}={v}"))
                .collect::<Vec<_>>()
                .join("; ");
            self.credential
                .set_password(&value)
                .map_err(|_| "无法保存登录会话到系统凭据存储")?;
            *self.cookie.lock().map_err(|_| "登录状态锁不可用")? = Some(value);
        }
        let message = match code {
            800 => "二维码已过期",
            801 => "等待扫码",
            802 => "请在网易云音乐中确认",
            803 => "登录成功",
            _ => "登录状态异常，请重试",
        };
        Ok(LoginStatus {
            code,
            message: message.into(),
        })
    }

    pub async fn session(&self) -> AppResult<bool> {
        if self
            .cookie
            .lock()
            .map_err(|_| "登录状态锁不可用")?
            .is_none()
        {
            return Ok(false);
        }
        let query = self.query()?;
        let body = checked(self.client.login_status(&query)).await?;
        Ok(body
            .pointer("/data/profile/userId")
            .or_else(|| body.pointer("/profile/userId"))
            .and_then(Value::as_u64)
            .is_some_and(|id| id > 0))
    }

    pub fn logout(&self) -> AppResult<()> {
        match self.credential.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(_) => return Err("无法清除系统凭据".into()),
        }
        *self.cookie.lock().map_err(|_| "登录状态锁不可用")? = None;
        Ok(())
    }
}

async fn timed<F: Future<Output = ncm_api_rs::error::Result<ApiResponse>>>(
    future: F,
) -> AppResult<ApiResponse> {
    tokio::time::timeout(Duration::from_secs(12), future)
        .await
        .map_err(|_| "网易云请求超时，请重试")?
        .map_err(|_| "网易云请求失败，请检查网络后重试".into())
}

async fn checked<F: Future<Output = ncm_api_rs::error::Result<ApiResponse>>>(
    future: F,
) -> AppResult<Value> {
    let response = timed(future).await?;
    match response
        .body
        .get("code")
        .and_then(Value::as_i64)
        .unwrap_or(response.status)
    {
        200 => Ok(response.body),
        301 | 302 => Err("网易云登录已失效，请重新扫码登录".into()),
        _ => Err("网易云暂未完成请求，请稍后重试".into()),
    }
}

fn track_from_json(song: &Value) -> Option<Track> {
    let id = song.get("id")?.as_u64()?;
    let artists = song.get("ar").or_else(|| song.get("artists"))?.as_array()?;
    let artist = artists
        .iter()
        .filter_map(|v| v.get("name")?.as_str())
        .collect::<Vec<_>>()
        .join(" / ");
    let album = song.get("al").or_else(|| song.get("album"));
    Some(Track {
        key: format!("netease:{id}"),
        title: song.get("name")?.as_str()?.into(),
        artist: if artist.is_empty() {
            "未知艺术家".into()
        } else {
            artist
        },
        album: album
            .and_then(|v| v.get("name"))
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .unwrap_or("未知专辑")
            .into(),
        duration_ms: song
            .get("dt")
            .or_else(|| song.get("duration"))
            .and_then(Value::as_u64)
            .unwrap_or(0),
        cover: album
            .and_then(|v| v.get("picUrl"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .into(),
        source: TrackSource::Netease { id },
    })
}
