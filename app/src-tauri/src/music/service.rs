//! Temporary host facade over the uniform contract; legacy queue DTOs remain intact.
use super::{
    manager::{AdapterManager, ResourceTicket},
    resource::ResolveRequest,
};
use crate::model::{AppResult, ResolvedTrack, Track, TrackSource};
use std::sync::Arc;

pub type ResolvedPlayback = (ResolvedTrack, Option<Arc<ResourceTicket>>);

pub struct MusicService {
    pub adapters: Arc<AdapterManager>,
    pub accounts: Option<Arc<super::accounts::AccountManager>>,
}
impl MusicService {
    pub fn new(adapters: Arc<AdapterManager>) -> Self {
        Self {
            adapters,
            accounts: None,
        }
    }
    pub fn legacy_stamp(&self) -> AppResult<(super::account::SessionContext, u64)> {
        self.adapters
            .stamp(&super::identity::SourceId::try_from("netease".to_owned()).unwrap())
            .map_err(|e| e.to_string())
    }
    pub async fn legacy_track(&self, id: u64) -> AppResult<Track> {
        let reference = super::netease::reference(id).map_err(|e| e.to_string())?;
        let track = self
            .adapters
            .read_track(&reference)
            .await
            .map_err(|e| e.to_string())?;
        super::netease::legacy(track).map_err(|e| e.to_string())
    }
    pub async fn resolve(
        &self,
        track: Track,
        quality: &str,
        downgrade: bool,
        generation: u64,
    ) -> AppResult<ResolvedPlayback> {
        if matches!(track.source, TrackSource::Local { .. }) {
            return crate::playback_resource::resolve(track)
                .await
                .map(|resolved| (resolved, None));
        }
        let reference = super::migration::legacy_track(
            &serde_json::to_string(&track).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?
        .track
        .reference;
        let ticket = self
            .adapters
            .resolve_playback(
                &ResolveRequest {
                    track: reference,
                    preferred_quality: quality.into(),
                    allow_downgrade: downgrade,
                },
                generation,
            )
            .await
            .map_err(|e| e.to_string())?;
        Ok((
            ResolvedTrack {
                decoded_audio: None,
                track,
                uri: ticket.uri().into(),
                quality: Some(ticket.quality().into()),
            },
            Some(ticket),
        ))
    }
}
