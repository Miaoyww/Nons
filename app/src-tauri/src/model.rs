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
    pub shuffle: bool,
    #[serde(default)]
    pub shuffle_order: Vec<usize>,
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
            shuffle: false,
            shuffle_order: vec![],
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
    pub fn reset_shuffle_order(&mut self, current: Option<usize>) {
        self.shuffle_order.clear();
        if self.shuffle {
            self.shuffle_order
                .extend((0..self.queue.len()).filter(|i| Some(*i) != current));
            fastrand::shuffle(&mut self.shuffle_order);
            if let Some(index) = current.filter(|i| *i < self.queue.len()) {
                self.shuffle_order.insert(0, index);
            }
        }
    }

    pub fn restore_shuffle_order(&mut self) {
        let mut sorted = self.shuffle_order.clone();
        sorted.sort_unstable();
        if sorted != (0..self.queue.len()).collect::<Vec<_>>() {
            self.reset_shuffle_order(self.index);
        }
        if !self.shuffle {
            self.shuffle_order.clear();
        }
    }

    pub fn following(&self, manual: bool) -> Option<usize> {
        let current = self.index.filter(|i| *i < self.queue.len())?;
        if !manual && self.repeat_mode == RepeatMode::One {
            return Some(current);
        }
        let mode = if manual && self.repeat_mode == RepeatMode::One {
            RepeatMode::All
        } else {
            self.repeat_mode
        };
        if self.shuffle {
            let slot = self.shuffle_order.iter().position(|i| *i == current)?;
            following_index(Some(slot), self.shuffle_order.len(), mode)
                .map(|i| self.shuffle_order[i])
        } else {
            following_index(Some(current), self.queue.len(), mode)
        }
    }

    pub fn previous(&self) -> Option<usize> {
        let current = self.index.filter(|i| *i < self.queue.len())?;
        let slot = if self.shuffle {
            self.shuffle_order.iter().position(|i| *i == current)?
        } else {
            current
        };
        let count = if self.shuffle {
            self.shuffle_order.len()
        } else {
            self.queue.len()
        };
        let previous = slot
            .checked_sub(1)
            .or_else(|| (self.repeat_mode != RepeatMode::Off).then_some(count - 1))?;
        Some(if self.shuffle {
            self.shuffle_order[previous]
        } else {
            previous
        })
    }

    pub fn insert_next(&mut self, tracks: Vec<Track>) -> AppResult<usize> {
        if tracks.len() + self.queue.len() > 1000 {
            return Err("播放队列最多支持 1000 首歌曲".into());
        }
        let position = self
            .index
            .map_or(0, |index| index + 1)
            .min(self.queue.len());
        let count = tracks.len();
        if self.shuffle {
            let slot = self
                .index
                .and_then(|current| self.shuffle_order.iter().position(|i| *i == current))
                .map_or(0, |i| i + 1);
            for index in &mut self.shuffle_order {
                if *index >= position {
                    *index += count;
                }
            }
            self.shuffle_order
                .splice(slot..slot, position..position + count);
        }
        self.queue.splice(position..position, tracks);
        if self.index.is_none() && !self.queue.is_empty() {
            self.index = Some(0);
            self.duration_ms = self.queue[0].duration_ms;
        }
        Ok(position)
    }

    pub fn remove_track(&mut self, index: usize, key: &str) -> AppResult<bool> {
        if self.queue.get(index).is_none_or(|track| track.key != key) {
            return Err("播放列表已变化，请重新选择歌曲".into());
        }
        let removed_current = self.index == Some(index);
        let shuffle_replacement = (removed_current && self.shuffle)
            .then(|| {
                self.following(true)
                    .filter(|i| *i != index)
                    .or_else(|| self.previous().filter(|i| *i != index))
            })
            .flatten();
        self.queue.remove(index);
        self.shuffle_order.retain(|i| *i != index);
        for entry in &mut self.shuffle_order {
            if *entry > index {
                *entry -= 1;
            }
        }
        self.index = self.index.and_then(|current| {
            if self.queue.is_empty() {
                None
            } else if let Some(replacement) = shuffle_replacement {
                Some(if replacement > index {
                    replacement - 1
                } else {
                    replacement
                })
            } else if current > index {
                Some(current - 1)
            } else {
                Some(current.min(self.queue.len() - 1))
            }
        });
        Ok(removed_current)
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub match_score: Option<u32>,
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
    #[test]
    fn shuffle_navigation_visits_each_entry_and_respects_repeat() {
        let mut state = PlayerSnapshot {
            shuffle: true,
            queue: (0..5).map(track).collect(),
            index: Some(2),
            ..Default::default()
        };
        state.reset_shuffle_order(state.index);
        assert_eq!(state.shuffle_order[0], 2);
        let mut visited = vec![2];
        while let Some(next) = state.following(false) {
            assert_eq!(
                state.following(false),
                Some(next),
                "preload must select the same entry as EOS"
            );
            let previous = state.index;
            state.index = Some(next);
            assert_eq!(state.previous(), previous);
            visited.push(next);
            assert!(visited.len() <= 5);
        }
        visited.sort_unstable();
        assert_eq!(visited, vec![0, 1, 2, 3, 4]);
        state.repeat_mode = RepeatMode::All;
        assert_eq!(state.following(false), Some(2));
        state.repeat_mode = RepeatMode::One;
        assert_eq!(state.following(false), state.index);
        assert_eq!(state.following(true), Some(2));
        state.shuffle = false;
        state.index = Some(2);
        assert_eq!(state.following(true), Some(3));
    }

    #[test]
    fn shuffle_edits_preserve_next_insertion_and_valid_indices() {
        let mut state = PlayerSnapshot {
            shuffle: true,
            queue: (0..4).map(track).collect(),
            index: Some(2),
            shuffle_order: vec![2, 0, 3, 1],
            ..Default::default()
        };
        state.insert_next(vec![track(8), track(9)]).unwrap();
        assert_eq!(state.following(true), Some(3));
        state.index = Some(3);
        assert_eq!(state.following(true), Some(4));
        state.remove_track(0, "0").unwrap();
        assert_eq!(state.index, Some(2));
        assert_eq!(state.following(true), Some(3));
        state.remove_track(2, "8").unwrap();
        let mut sorted = state.shuffle_order.clone();
        sorted.sort_unstable();
        assert_eq!(sorted, (0..state.queue.len()).collect::<Vec<_>>());
        state.shuffle_order = vec![99, 99];
        state.restore_shuffle_order();
        assert_eq!(state.shuffle_order[0], state.index.unwrap());
        let restored: PlayerSnapshot =
            serde_json::from_str(&serde_json::to_string(&state).unwrap()).unwrap();
        assert_eq!(restored.shuffle_order, state.shuffle_order);
    }

    #[test]
    fn shuffle_handles_empty_and_single_track_queues() {
        let mut state = PlayerSnapshot {
            shuffle: true,
            ..Default::default()
        };
        assert_eq!(state.following(false), None);
        assert_eq!(state.previous(), None);
        state.insert_next(vec![track(1)]).unwrap();
        assert_eq!(state.following(false), None);
        state.repeat_mode = RepeatMode::All;
        assert_eq!(state.following(false), Some(0));
        assert_eq!(state.previous(), Some(0));
    }

    #[test]
    fn removing_current_in_shuffle_uses_play_order_instead_of_list_position() {
        let mut state = PlayerSnapshot {
            shuffle: true,
            queue: (0..4).map(track).collect(),
            index: Some(1),
            shuffle_order: vec![1, 3, 0, 2],
            ..Default::default()
        };
        state.remove_track(1, "1").unwrap();
        assert_eq!(state.current().unwrap().key, "3");
        assert_eq!(state.following(true), Some(0));
        state.index = Some(1);
        state.remove_track(1, "2").unwrap();
        assert_eq!(
            state.current().unwrap().key,
            "0",
            "last shuffled entry falls back to previous"
        );
    }
    fn track(id: u64) -> Track {
        Track {
            key: id.to_string(),
            title: id.to_string(),
            aliases: vec![],
            artists: vec![],
            album_id: None,
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
    fn removing_queue_entries_preserves_current_playback_and_checks_identity() {
        let mut state = PlayerSnapshot {
            queue: vec![track(1), track(2), track(1), track(3)],
            index: Some(2),
            position_ms: 500,
            status: PlaybackStatus::Playing,
            ..PlayerSnapshot::default()
        };
        assert!(state.remove_track(1, "wrong").is_err());
        assert_eq!(state.queue.len(), 4);
        assert!(!state.remove_track(0, "1").unwrap());
        assert_eq!(state.index, Some(1));
        assert_eq!(state.current().unwrap().key, "1");
        assert_eq!(state.position_ms, 500);
        assert_eq!(state.status, PlaybackStatus::Playing);
        assert!(!state.remove_track(2, "3").unwrap());
        assert_eq!(state.index, Some(1));
    }
    #[test]
    fn removing_current_selects_next_then_previous_and_supports_empty_queue() {
        let mut state = PlayerSnapshot {
            queue: vec![track(1), track(2), track(3)],
            index: Some(1),
            ..PlayerSnapshot::default()
        };
        assert!(state.remove_track(1, "2").unwrap());
        assert_eq!(state.current().unwrap().key, "3");
        assert!(state.remove_track(1, "3").unwrap());
        assert_eq!(state.current().unwrap().key, "1");
        assert!(state.remove_track(0, "1").unwrap());
        assert!(state.queue.is_empty());
        assert_eq!(state.index, None);
        assert!(state.remove_track(0, "1").is_err());
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
