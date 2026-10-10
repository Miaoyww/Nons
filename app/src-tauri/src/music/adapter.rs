use super::{
    account::SessionContext,
    identity::{EntityRef, MusicTrack, SourceId},
    resource::{PlaybackResource, ResolveRequest},
    ErrorCode, MusicResult,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    future::Future,
    pin::Pin,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Instant,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Capability {
    Search,
    Browse,
    Account,
    UserLibrary,
    Favorites,
    PlaylistWrite,
    Recommendations,
    PrivateFm,
    Lyrics,
    Download,
}

/// Track read and playback resolution are mandatory, not optional capability groups.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDescriptor {
    pub source: SourceId,
    pub display_name: String,
    pub contract_version: u32,
    pub capabilities: BTreeSet<Capability>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum OperationAvailability {
    Available,
    Unavailable { reason: super::ErrorCode },
}

impl SourceDescriptor {
    pub fn validate(&self) -> MusicResult<()> {
        if self.contract_version != super::CONTRACT_VERSION {
            return Err(ErrorCode::Unsupported.into());
        }
        if self.source.as_str() == "local"
            || self.display_name.trim().is_empty()
            || self.display_name.len() > 256
        {
            return Err(ErrorCode::InvalidData.into());
        }
        Ok(())
    }
    /// Account/track restrictions are separate from what the adapter implements.
    pub fn availability(
        &self,
        capability: Capability,
        restriction: Option<ErrorCode>,
    ) -> OperationAvailability {
        match (self.capabilities.contains(&capability), restriction) {
            (false, _) => OperationAvailability::Unavailable {
                reason: ErrorCode::Unsupported,
            },
            (true, Some(reason)) => OperationAvailability::Unavailable { reason },
            (true, None) => OperationAvailability::Available,
        }
    }
}

#[derive(Clone, Default)]
pub struct Cancellation(Arc<AtomicBool>);
impl Cancellation {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}

#[derive(Clone)]
pub struct RequestContext {
    pub session: SessionContext,
    pub adapter_generation: u64,
    pub deadline: Instant,
    pub cancellation: Cancellation,
}

impl RequestContext {
    /// Admission and publication checks. Managers must also enforce an async timeout
    /// and cancellation while awaiting work, rather than relying on cooperative checks.
    pub fn check(
        &self,
        current_session: &SessionContext,
        current_adapter_generation: u64,
    ) -> MusicResult<()> {
        if self.cancellation.is_cancelled() {
            return Err(ErrorCode::Cancelled.into());
        }
        if Instant::now() >= self.deadline {
            return Err(ErrorCode::DeadlineExceeded.into());
        }
        if &self.session != current_session || self.adapter_generation != current_adapter_generation
        {
            return Err(ErrorCode::StaleContext.into());
        }
        Ok(())
    }
    pub fn check_reference(&self, reference: &EntityRef) -> MusicResult<()> {
        if reference.source != self.session.source
            || reference.kind != super::identity::EntityKind::Track
        {
            return Err(ErrorCode::InvalidData.into());
        }
        Ok(())
    }
}

/// A cursor is not an entity ID and may encode arbitrary platform pagination state.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String")]
pub struct Cursor(String);
impl Cursor {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}
impl TryFrom<String> for Cursor {
    type Error = super::MusicError;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        if value.is_empty() || value.len() > 4096 {
            return Err(ErrorCode::InvalidData.into());
        }
        Ok(Self(value))
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageRequest {
    pub cursor: Option<Cursor>,
    pub limit: u16,
}
impl PageRequest {
    pub fn validate(&self) -> MusicResult<()> {
        if self.limit == 0 || self.limit > 100 {
            return Err(ErrorCode::InvalidData.into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<Cursor>,
}
impl<T: Serialize> Page<T> {
    pub fn validate(&self, request: &PageRequest) -> MusicResult<()> {
        request.validate()?;
        if self.items.len() > usize::from(request.limit)
            || serde_json::to_vec(self)
                .map_err(|_| super::MusicError::from(ErrorCode::InvalidData))?
                .len()
                > 2 * 1024 * 1024
        {
            return Err(ErrorCode::InvalidData.into());
        }
        Ok(())
    }
}

/// Host-owned cache identity; actual results still use the existing cache services.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheScope {
    pub source: SourceId,
    pub account: Option<super::identity::OpaqueId>,
    pub session_generation: u64,
    pub adapter_generation: u64,
    pub operation: String,
    /// Canonicalized business parameters only, never credentials or resource URLs.
    pub parameters: String,
}

/// Suggestions only: the host clamps TTL/size and owns eviction and invalidation.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheAdvice {
    pub max_age_ms: u64,
}

/// Published only after a successful write under a still-current request context.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteImpact {
    pub operations: BTreeSet<String>,
    pub entities: Vec<EntityRef>,
}

pub type AdapterFuture<'a, T> = Pin<Box<dyn Future<Output = MusicResult<T>> + Send + 'a>>;

/// Backend-only base contract. Optional groups acquire methods as they are migrated.
/// AdapterManager must validate DTO size/kind/source and context before publishing.
pub trait MusicAdapter: Send + Sync {
    fn descriptor(&self) -> &SourceDescriptor;
    fn read_track<'a>(
        &'a self,
        reference: &'a EntityRef,
        context: &'a RequestContext,
    ) -> AdapterFuture<'a, MusicTrack>;
    fn resolve_playback<'a>(
        &'a self,
        request: &'a ResolveRequest,
        context: &'a RequestContext,
    ) -> AdapterFuture<'a, PlaybackResource>;
}
