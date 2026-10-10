//! Pure, read-only legacy conversion. Persistence transactions are wired in later phases.
use super::{
    identity::{EntityKind, EntityRef, MusicCredit, MusicTrack, OpaqueId, SourceId},
    ErrorCode, MusicResult, CONTRACT_VERSION,
};
use crate::model::{PlayerSnapshot, Track, TrackSource};
use serde::{Deserialize, Serialize};

pub const LEGACY_KEYRING_SERVICE: &str = "NonsPlayer";
pub const LEGACY_KEYRING_USER: &str = "netease-session";

/// Local path stays outside the serializable public track, in host-owned storage.
pub struct LocalBinding {
    pub reference: EntityRef,
    pub path: String,
    pub cover: String,
}

pub struct MigratedTrack {
    pub legacy_key: String,
    pub track: MusicTrack,
    pub local_binding: Option<LocalBinding>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedQueue {
    pub version: u32,
    pub tracks: Vec<MusicTrack>,
    pub index: Option<usize>,
    pub shuffle: bool,
    pub shuffle_order: Vec<usize>,
    pub repeat_mode: QueueRepeatMode,
    pub volume: f64,
    pub device_id: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QueueRepeatMode {
    Off,
    All,
    One,
}

/// The caller persists bindings and key mappings in the same transaction as the queue.
pub struct MigratedQueue {
    pub queue: SavedQueue,
    pub tracks: Vec<MigratedTrack>,
}

fn reference(source: &str, kind: EntityKind, id: String) -> MusicResult<EntityRef> {
    Ok(EntityRef {
        source: SourceId::try_from(source.to_owned())?,
        kind,
        id: OpaqueId::try_from(id)?,
    })
}

fn netease_reference(kind: EntityKind, id: u64) -> MusicResult<EntityRef> {
    if id == 0 {
        return Err(ErrorCode::InvalidData.into());
    }
    reference("netease", kind, id.to_string())
}

fn convert_track(track: Track) -> MusicResult<MigratedTrack> {
    let (identity, local_binding, associations, online) = match &track.source {
        TrackSource::Netease { id } => (
            netease_reference(EntityKind::Track, *id)?,
            None,
            vec![],
            true,
        ),
        TrackSource::Local { path, netease_id } => {
            if path.is_empty() {
                return Err(ErrorCode::InvalidData.into());
            }
            let id = track
                .key
                .strip_prefix("local:")
                .ok_or(ErrorCode::InvalidData)?;
            let identity = reference("local", EntityKind::Track, id.into())?;
            let association = netease_id
                .map(|id| netease_reference(EntityKind::Track, id))
                .transpose()?;
            (
                identity.clone(),
                Some(LocalBinding {
                    reference: identity,
                    path: path.clone(),
                    cover: track.cover.clone(),
                }),
                association.into_iter().collect(),
                false,
            )
        }
    };
    let artists = track
        .artists
        .into_iter()
        .map(|credit| {
            Ok(MusicCredit {
                name: credit.name,
                // Local credit IDs must not become remote identities through a lyric binding.
                reference: if online {
                    credit
                        .id
                        .map(|id| netease_reference(EntityKind::Artist, id))
                        .transpose()?
                } else {
                    None
                },
            })
        })
        .collect::<MusicResult<Vec<_>>>()?;
    let album_reference = if online {
        track
            .album_id
            .map(|id| netease_reference(EntityKind::Album, id))
            .transpose()?
    } else {
        None
    };
    let result = MigratedTrack {
        legacy_key: track.key,
        track: MusicTrack {
            reference: identity,
            title: track.title,
            aliases: track.aliases,
            artist: track.artist,
            artists,
            album: track.album,
            album_reference,
            duration_ms: track.duration_ms,
            // Host resolves local artwork using the binding, never a public file path.
            cover: if online { track.cover } else { String::new() },
            associations,
        },
        local_binding,
    };
    result.track.validate(&result.track.reference)?;
    Ok(result)
}

pub fn legacy_track(json: &str) -> MusicResult<MigratedTrack> {
    if json.len() > 64 * 1024 {
        return Err(ErrorCode::InvalidData.into());
    }
    convert_track(serde_json::from_str(json).map_err(|_| ErrorCode::InvalidData)?)
}

pub fn legacy_queue(json: &str) -> MusicResult<MigratedQueue> {
    if json.len() > 8 * 1024 * 1024 {
        return Err(ErrorCode::InvalidData.into());
    }
    let mut state: PlayerSnapshot =
        serde_json::from_str(json).map_err(|_| ErrorCode::InvalidData)?;
    if state.queue.len() > 1000
        || state.index.is_some_and(|index| index >= state.queue.len())
        || !state.volume.is_finite()
        || !(0.0..=1.0).contains(&state.volume)
    {
        return Err(ErrorCode::InvalidData.into());
    }
    state.restore_shuffle_order();
    let tracks = state
        .queue
        .into_iter()
        .map(convert_track)
        .collect::<MusicResult<Vec<_>>>()?;
    let queue = SavedQueue {
        version: CONTRACT_VERSION,
        tracks: tracks.iter().map(|t| t.track.clone()).collect(),
        index: state.index,
        shuffle: state.shuffle,
        shuffle_order: state.shuffle_order,
        repeat_mode: match state.repeat_mode {
            crate::model::RepeatMode::Off => QueueRepeatMode::Off,
            crate::model::RepeatMode::All => QueueRepeatMode::All,
            crate::model::RepeatMode::One => QueueRepeatMode::One,
        },
        volume: state.volume,
        device_id: state.device_id,
    };
    Ok(MigratedQueue { queue, tracks })
}

/// Pure account identity conversion; credentials are read/moved by AccountManager later.
/// Missing/invalid profile stays pending, never mapped to a made-up account ID.
pub fn legacy_account(profile: &str) -> MusicResult<super::account::AccountRecord> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct LegacyProfile {
        user_id: u64,
        nickname: String,
        avatar_url: String,
    }
    if profile.len() > 64 * 1024 {
        return Err(ErrorCode::InvalidData.into());
    }
    let value: LegacyProfile = serde_json::from_str(profile).map_err(|_| ErrorCode::InvalidData)?;
    if value.user_id == 0 {
        return Err(ErrorCode::InvalidData.into());
    }
    Ok(super::account::AccountRecord {
        reference: super::account::AccountRef {
            source: SourceId::try_from("netease".to_owned())?,
            id: OpaqueId::try_from(value.user_id.to_string())?,
        },
        display_name: value.nickname,
        avatar: value.avatar_url,
    })
}
