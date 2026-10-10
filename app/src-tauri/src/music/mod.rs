//! ADR 0006 phase-one contracts. No adapter is registered and no IPC is exposed yet.
//! See docs/music-adapters.md before wiring these types into persistence or playback.

pub mod account;
pub mod adapter;
pub mod identity;
pub mod migration;
pub mod resource;
#[cfg(test)]
mod tests;

use serde::{Deserialize, Serialize};

pub const CONTRACT_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    Unauthenticated,
    NotFound,
    PermissionDenied,
    RegionRestricted,
    RateLimited,
    Network,
    Unsupported,
    SourceUnavailable,
    Cancelled,
    DeadlineExceeded,
    StaleContext,
    InvalidData,
    Internal,
}

/// Public errors carry stable codes only. Raw platform errors are not public messages.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MusicError {
    pub code: ErrorCode,
    pub retry_after_ms: Option<u64>,
}

impl From<ErrorCode> for MusicError {
    fn from(code: ErrorCode) -> Self {
        Self {
            code,
            retry_after_ms: None,
        }
    }
}

impl std::fmt::Display for MusicError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self.code)
    }
}

impl std::error::Error for MusicError {}

pub type MusicResult<T> = Result<T, MusicError>;
