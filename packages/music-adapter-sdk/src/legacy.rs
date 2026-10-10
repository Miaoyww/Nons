pub const MAX_LYRIC_BYTES: usize = 2 * 1024 * 1024;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TrackSource {
    Netease {
        id: u64,
    },
    Local {
        path: String,
        netease_id: Option<u64>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicCredit {
    pub name: String,
    pub id: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub key: String,
    pub title: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    pub artist: String,
    #[serde(default)]
    pub artists: Vec<MusicCredit>,
    #[serde(default)]
    pub album_id: Option<u64>,
    pub album: String,
    pub duration_ms: u64,
    pub cover: String,
    pub source: TrackSource,
}

impl Track {
    pub fn netease_id(&self) -> Option<u64> {
        match &self.source {
            TrackSource::Netease { id } => Some(*id),
            TrackSource::Local { netease_id, .. } => *netease_id,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lyrics {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub match_score: Option<u32>,
    pub source: String,
    pub format: String,
    pub content: String,
    pub translation: Option<String>,
    pub romanization: Option<String>,
}

pub type AppResult<T> = Result<T, String>;
