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
    #[serde(default)]
    pub aliases: Vec<String>,
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
    #[serde(default)]
    pub repeat_mode: RepeatMode,
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
            repeat_mode: RepeatMode::Off,
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
    pub fn insert_next(&mut self, tracks: Vec<Track>) -> AppResult<usize> {
        if tracks.len() + self.queue.len() > 1000 {
            return Err("播放队列最多支持 1000 首歌曲".into());
        }
        let position = self
            .index
            .map_or(0, |index| index + 1)
            .min(self.queue.len());
        self.queue.splice(position..position, tracks);
        if self.index.is_none() && !self.queue.is_empty() {
            self.index = Some(0);
            self.duration_ms = self.queue[0].duration_ms;
        }
        Ok(position)
    }

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

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RepeatMode {
    #[default]
    Off,
    All,
    One,
}

pub fn following_index(index: Option<usize>, count: usize, mode: RepeatMode) -> Option<usize> {
    let current = index.filter(|i| *i < count)?;
    match mode {
        RepeatMode::One => Some(current),
        RepeatMode::All => Some((current + 1) % count),
        RepeatMode::Off => next_index(index, count),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn track(id: u64) -> Track {
        Track {
            key: id.to_string(),
            title: id.to_string(),
            aliases: vec![],
            artist: String::new(),
            album: String::new(),
            duration_ms: 1000,
            cover: String::new(),
            source: TrackSource::Netease { id },
        }
    }
    #[test]
    fn next_insertion_preserves_current_playback_and_batch_order() {
        let mut state = PlayerSnapshot {
            queue: vec![track(1), track(2), track(3)],
            index: Some(1),
            position_ms: 500,
            status: PlaybackStatus::Playing,
            ..Default::default()
        };
        assert_eq!(state.insert_next(vec![track(4), track(5)]).unwrap(), 2);
        assert_eq!(
            state
                .queue
                .iter()
                .map(|t| t.key.as_str())
                .collect::<Vec<_>>(),
            vec!["1", "2", "4", "5", "3"]
        );
        assert_eq!(state.current().unwrap().key, "2");
        assert_eq!(state.position_ms, 500);
        assert_eq!(state.status, PlaybackStatus::Playing);
        state.insert_next(vec![track(6)]).unwrap();
        assert_eq!(state.queue[2].key, "6");
    }
    #[test]
    fn next_insertion_supports_empty_and_last_track_queues_and_enforces_limit() {
        let mut state = PlayerSnapshot::default();
        state.insert_next(vec![track(1)]).unwrap();
        assert_eq!(state.index, Some(0));
        assert_eq!(state.status, PlaybackStatus::Stopped);
        state.insert_next(vec![track(2)]).unwrap();
        assert_eq!(state.queue[1].key, "2");
        assert!(state.insert_next(vec![track(3); 999]).is_err());
        assert_eq!(state.queue.len(), 2);
    }
    #[test]
    fn repeat_respects_queue_boundaries() {
        assert_eq!(following_index(Some(1), 2, RepeatMode::All), Some(0));
        assert_eq!(following_index(Some(1), 2, RepeatMode::One), Some(1));
        assert_eq!(following_index(Some(0), 1, RepeatMode::All), Some(0));
        assert_eq!(following_index(None, 0, RepeatMode::All), None);
        assert_eq!(following_index(Some(usize::MAX), 2, RepeatMode::One), None);
    }
    #[test]
    fn a_finished_queue_does_not_repeat_or_wrap() {
        assert_eq!(next_index(Some(0), 2), Some(1));
        assert_eq!(next_index(Some(1), 2), None);
        assert_eq!(next_index(None, 2), None);
        assert_eq!(next_index(Some(usize::MAX), 2), None);
    }
}
