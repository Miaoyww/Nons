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
pub struct Track {
    pub key: String,
    pub title: String,
    pub artist: String,
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

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackStatus {
    #[default]
    Stopped,
    Loading,
    Playing,
    Paused,
    Buffering,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerSnapshot {
    pub revision: u64,
    pub queue: Vec<Track>,
    pub index: Option<usize>,
    pub status: PlaybackStatus,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub volume: f64,
    pub device_id: Option<String>,
    pub actual_quality: Option<String>,
    pub error: Option<String>,
    pub media_error: Option<String>,
}

impl Default for PlayerSnapshot {
    fn default() -> Self {
        Self {
            revision: 0,
            queue: vec![],
            index: None,
            status: PlaybackStatus::Stopped,
            position_ms: 0,
            duration_ms: 0,
            volume: 0.8,
            device_id: None,
            actual_quality: None,
            error: None,
            media_error: None,
        }
    }
}

impl PlayerSnapshot {
    pub fn current(&self) -> Option<&Track> {
        self.index.and_then(|index| self.queue.get(index))
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub revision: u64,
    pub position_ms: u64,
    pub duration_ms: u64,
    pub status: PlaybackStatus,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputDevice {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lyrics {
    pub source: String,
    pub format: String,
    pub content: String,
    pub translation: Option<String>,
    pub romanization: Option<String>,
}

#[derive(Clone, Debug)]
pub struct ResolvedTrack {
    pub track: Track,
    pub uri: String,
    pub quality: Option<String>,
}

pub type AppResult<T> = Result<T, String>;

pub fn next_index(index: Option<usize>, count: usize) -> Option<usize> {
    index.and_then(|i| i.checked_add(1)).filter(|i| *i < count)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_finished_queue_does_not_repeat_or_wrap() {
        assert_eq!(next_index(Some(0), 2), Some(1));
        assert_eq!(next_index(Some(1), 2), None);
        assert_eq!(next_index(None, 2), None);
        assert_eq!(next_index(Some(usize::MAX), 2), None);
    }
}
