//! Built-in provider and legacy DTO compatibility stay at the platform boundary.
use super::{
    account::SessionContext, adapter::*, identity::*, resource::*, ErrorCode, MusicResult,
};
use crate::{
    model::{Track, TrackSource},
    netease::Netease,
};
use std::sync::Arc;

pub struct NeteaseAdapter {
    client: Arc<Netease>,
    descriptor: SourceDescriptor,
}
impl NeteaseAdapter {
    pub fn new(client: Arc<Netease>) -> Self {
        Self {
            client,
            descriptor: SourceDescriptor {
                source: SourceId::try_from("netease".to_owned()).expect("reserved source"),
                display_name: "网易云音乐".into(),
                contract_version: super::CONTRACT_VERSION,
                // Optional groups are still direct legacy APIs until phase three.
                capabilities: Default::default(),
            },
        }
    }
}
fn numeric_id(reference: &EntityRef) -> MusicResult<u64> {
    let id = reference
        .id
        .as_str()
        .parse::<u64>()
        .map_err(|_| ErrorCode::InvalidData)?;
    if id == 0 || id > 9_007_199_254_740_991 || id.to_string() != reference.id.as_str() {
        return Err(ErrorCode::InvalidData.into());
    }
    Ok(id)
}
impl MusicAdapter for NeteaseAdapter {
    fn descriptor(&self) -> &SourceDescriptor {
        &self.descriptor
    }
    fn read_track<'a>(
        &'a self,
        reference: &'a EntityRef,
        context: &'a RequestContext,
    ) -> AdapterFuture<'a, MusicTrack> {
        Box::pin(async move {
            context.check_reference(reference)?;
            let track = self
                .client
                .song(numeric_id(reference)?)
                .await
                .inspect_err(|error| {
                    if error.code == ErrorCode::Unauthenticated {
                        self.client.invalidate_session(context.session.generation);
                    }
                })?;
            super::migration::legacy_track(
                &serde_json::to_string(&track).map_err(|_| ErrorCode::InvalidData)?,
            )
            .map(|v| v.track)
        })
    }
    fn resolve_playback<'a>(
        &'a self,
        request: &'a ResolveRequest,
        context: &'a RequestContext,
    ) -> AdapterFuture<'a, PlaybackResource> {
        Box::pin(async move {
            request.validate(context)?;
            self.client
                .resolve_resource(
                    numeric_id(&request.track)?,
                    &request.preferred_quality,
                    request.allow_downgrade,
                )
                .await
                .inspect_err(|error| {
                    if error.code == ErrorCode::Unauthenticated {
                        self.client.invalidate_session(context.session.generation);
                    }
                })
        })
    }
}
pub(super) fn session(client: &Netease) -> SessionContext {
    // The legacy store has one session and no confirmed persistent account ID.
    // Do not invent an account identity or copy credentials into adapter storage.
    SessionContext {
        source: SourceId::try_from("netease".to_owned()).unwrap(),
        account: None,
        generation: client.session_generation(),
    }
}
pub(super) fn reference(id: u64) -> MusicResult<EntityRef> {
    Ok(EntityRef {
        source: SourceId::try_from("netease".to_owned())?,
        kind: EntityKind::Track,
        id: OpaqueId::try_from(id.to_string())?,
    })
}
pub(super) fn legacy(track: MusicTrack) -> MusicResult<Track> {
    let id = numeric_id(&track.reference)?;
    Ok(Track {
        key: format!("netease:{id}"),
        title: track.title,
        aliases: track.aliases,
        artist: track.artist,
        artists: track
            .artists
            .into_iter()
            .map(|credit| crate::model::MusicCredit {
                name: credit.name,
                id: credit.reference.and_then(|r| r.id.as_str().parse().ok()),
            })
            .collect(),
        album: track.album,
        album_id: track
            .album_reference
            .and_then(|r| r.id.as_str().parse().ok()),
        duration_ms: track.duration_ms,
        cover: track.cover,
        source: TrackSource::Netease { id },
    })
}

/// Platform-specific startup wiring; callers receive only the uniform music service.
pub(crate) fn builtin_service(
    client: Arc<Netease>,
) -> crate::model::AppResult<super::service::MusicService> {
    let adapters = Arc::new(super::manager::AdapterManager::default());
    let session_client = client.clone();
    adapters
        .register(
            Arc::new(NeteaseAdapter::new(client)),
            Arc::new(move || session(&session_client)),
        )
        .map_err(|e| e.to_string())?;
    Ok(super::service::MusicService::new(adapters))
}
