//! Backend registry, admission budgets and revocable resource ownership.
use super::{
    account::SessionContext, adapter::*, identity::*, resource::*, ErrorCode, MusicResult,
};
use std::{
    collections::BTreeMap,
    future::Future,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, Weak,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::sync::Semaphore;

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}
type SessionProvider = Arc<dyn Fn() -> SessionContext + Send + Sync>;
struct Entry {
    adapter: Arc<dyn MusicAdapter>,
    session: SessionProvider,
    generation: AtomicU64,
    reads: Semaphore,
    playback: Semaphore,
}
impl Entry {
    fn check(&self, context: &RequestContext) -> MusicResult<()> {
        if self.generation.load(Ordering::Acquire).is_multiple_of(2) {
            return Err(ErrorCode::SourceUnavailable.into());
        }
        context.check(&(self.session)(), self.generation.load(Ordering::Acquire))
    }
}
#[derive(Default)]
pub struct AdapterManager {
    entries: Mutex<BTreeMap<SourceId, Arc<Entry>>>,
    resources: Mutex<BTreeMap<String, Weak<ResourceTicket>>>,
    next_handle: AtomicU64,
}
/// This ownership token is backend-only. Access is never serialized or logged.
pub struct ResourceTicket {
    entry: Arc<Entry>,
    lease: ResourceLease,
    resource: PlaybackResource,
}
impl std::fmt::Debug for ResourceTicket {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ResourceTicket([redacted])")
    }
}
impl ResourceTicket {
    /// Lightweight atomic checks are safe at the gapless handoff; no network/IO.
    pub fn check(&self, playback_generation: u64) -> MusicResult<()> {
        if self
            .entry
            .generation
            .load(Ordering::Acquire)
            .is_multiple_of(2)
        {
            return Err(ErrorCode::SourceUnavailable.into());
        }
        self.lease.check(
            &(self.entry.session)(),
            self.entry.generation.load(Ordering::Acquire),
            playback_generation,
        )
    }
    pub(crate) fn uri(&self) -> &str {
        match &self.resource.access {
            ResourceAccess::Http(http) => &http.url,
        }
    }
    pub(crate) fn quality(&self) -> &str {
        &self.resource.metadata.actual_quality
    }
}
impl AdapterManager {
    pub fn register(
        &self,
        adapter: Arc<dyn MusicAdapter>,
        session: SessionProvider,
    ) -> MusicResult<()> {
        adapter.descriptor().validate()?;
        let source = adapter.descriptor().source.clone();
        if (session)().source != source {
            return Err(ErrorCode::InvalidData.into());
        }
        let mut entries = self.entries.lock().map_err(|_| ErrorCode::Internal)?;
        if entries.contains_key(&source) {
            return Err(ErrorCode::InvalidData.into());
        }
        entries.insert(
            source,
            Arc::new(Entry {
                adapter,
                session,
                generation: AtomicU64::new(1),
                reads: Semaphore::new(4),
                playback: Semaphore::new(2),
            }),
        );
        Ok(())
    }
    pub fn set_enabled(&self, source: &SourceId, enabled: bool) -> MusicResult<()> {
        let entry = self.entry(source)?;
        entry
            .generation
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |current| {
                (current.is_multiple_of(2) == enabled).then_some(current + 1)
            })
            .ok();
        Ok(())
    }
    /// Internal built-in reload; package loading is introduced with external ABI.
    pub fn reload(&self, source: &SourceId) -> MusicResult<()> {
        self.entry(source)?
            .generation
            .fetch_add(2, Ordering::AcqRel);
        Ok(())
    }
    fn entry(&self, source: &SourceId) -> MusicResult<Arc<Entry>> {
        self.entries
            .lock()
            .map_err(|_| ErrorCode::Internal)?
            .get(source)
            .cloned()
            .ok_or_else(|| ErrorCode::SourceUnavailable.into())
    }
    pub fn stamp(&self, source: &SourceId) -> MusicResult<(SessionContext, u64)> {
        let entry = self.entry(source)?;
        if entry.generation.load(Ordering::Acquire).is_multiple_of(2) {
            return Err(ErrorCode::SourceUnavailable.into());
        }
        Ok(((entry.session)(), entry.generation.load(Ordering::Acquire)))
    }
    fn context(entry: &Entry, budget: Duration) -> RequestContext {
        RequestContext {
            session: (entry.session)(),
            adapter_generation: entry.generation.load(Ordering::Acquire),
            deadline: Instant::now() + budget,
            cancellation: Cancellation::default(),
        }
    }
    async fn run<T>(
        &self,
        entry: &Entry,
        context: &RequestContext,
        future: impl Future<Output = MusicResult<T>>,
    ) -> MusicResult<T> {
        entry.check(context)?;
        tokio::pin!(future);
        let deadline = tokio::time::sleep_until(context.deadline.into());
        tokio::pin!(deadline);
        let mut checks = tokio::time::interval(Duration::from_millis(10));
        loop {
            tokio::select! {
                biased;
                _ = &mut deadline => return Err(ErrorCode::DeadlineExceeded.into()),
                _ = checks.tick() => entry.check(context)?,
                result = &mut future => { entry.check(context)?; return result; }
            }
        }
    }
    pub async fn read_track(&self, reference: &EntityRef) -> MusicResult<MusicTrack> {
        let entry = self.entry(&reference.source)?;
        let context = Self::context(&entry, Duration::from_secs(3));
        context.check_reference(reference)?;
        // Reject overload rather than create an unbounded waiting queue.
        let _permit = entry
            .reads
            .try_acquire()
            .map_err(|_| ErrorCode::RateLimited)?;
        let track = self
            .run(
                &entry,
                &context,
                entry.adapter.read_track(reference, &context),
            )
            .await?;
        track.validate(reference)?;
        entry.check(&context)?;
        Ok(track)
    }
    pub async fn resolve_playback(
        &self,
        request: &ResolveRequest,
        playback_generation: u64,
    ) -> MusicResult<Arc<ResourceTicket>> {
        let entry = self.entry(&request.track.source)?;
        let context = Self::context(&entry, Duration::from_secs(12));
        request.validate(&context)?;
        let _permit = entry
            .playback
            .try_acquire()
            .map_err(|_| ErrorCode::RateLimited)?;
        let resource = self
            .run(
                &entry,
                &context,
                entry.adapter.resolve_playback(request, &context),
            )
            .await?;
        resource.metadata.require_full(now_ms())?;
        validate_access(&resource.access)?;
        let ttl = resource
            .metadata
            .expires_at_ms
            .map(|expiry| expiry.saturating_sub(now_ms()))
            .unwrap_or(60_000)
            .min(60_000);
        if ttl == 0 {
            return Err(ErrorCode::DeadlineExceeded.into());
        }
        entry.check(&context)?;
        let mut resources = self.resources.lock().map_err(|_| ErrorCode::Internal)?;
        resources.retain(|_, v| v.strong_count() > 0);
        if resources.len() >= 16 {
            return Err(ErrorCode::RateLimited.into());
        }
        let handle = ResourceHandle::try_from(format!(
            "resource-{}",
            self.next_handle.fetch_add(1, Ordering::Relaxed)
        ))?;
        let ticket = Arc::new(ResourceTicket {
            entry: entry.clone(),
            lease: ResourceLease {
                handle,
                context,
                playback_generation,
                valid_until: Instant::now() + Duration::from_millis(ttl),
            },
            resource,
        });
        resources.insert(ticket.lease.handle.as_str().into(), Arc::downgrade(&ticket));
        ticket.check(playback_generation)?;
        Ok(ticket)
    }
}
fn validate_access(access: &ResourceAccess) -> MusicResult<()> {
    let ResourceAccess::Http(http) = access;
    if http.url.len() > 8192 {
        return Err(ErrorCode::InvalidData.into());
    }
    let url = url::Url::parse(&http.url).map_err(|_| ErrorCode::InvalidData)?;
    if !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(ErrorCode::InvalidData.into());
    }
    // The phase-two URI-only audio transport cannot inject credential headers.
    // Reject these explicitly until the controlled transport implements them.
    if !http.headers.is_empty() {
        return Err(ErrorCode::Unsupported.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::resource::{HttpAccess, PlaybackExtent, ResourceMetadata};
    use super::*;
    struct TestAdapter {
        descriptor: SourceDescriptor,
        blocked: bool,
        entered: Arc<tokio::sync::Notify>,
        calls: Arc<AtomicU64>,
        wrong_identity: bool,
        expiry: Option<u64>,
    }
    impl MusicAdapter for TestAdapter {
        fn descriptor(&self) -> &SourceDescriptor {
            &self.descriptor
        }
        fn read_track<'a>(
            &'a self,
            reference: &'a EntityRef,
            _: &'a RequestContext,
        ) -> AdapterFuture<'a, MusicTrack> {
            Box::pin(async move {
                self.calls.fetch_add(1, Ordering::SeqCst);
                self.entered.notify_one();
                if self.blocked {
                    std::future::pending::<()>().await;
                }
                Ok(MusicTrack {
                    reference: if self.wrong_identity {
                        reference_for("other")
                    } else {
                        reference.clone()
                    },
                    title: "song".into(),
                    aliases: vec![],
                    artist: "artist".into(),
                    artists: vec![],
                    album: "album".into(),
                    album_reference: None,
                    duration_ms: 1000,
                    cover: String::new(),
                    associations: vec![],
                })
            })
        }
        fn resolve_playback<'a>(
            &'a self,
            _: &'a ResolveRequest,
            _: &'a RequestContext,
        ) -> AdapterFuture<'a, PlaybackResource> {
            Box::pin(async move {
                Ok(PlaybackResource {
                    metadata: ResourceMetadata {
                        actual_quality: "test".into(),
                        extent: PlaybackExtent::Full,
                        expires_at_ms: self.expiry,
                    },
                    access: ResourceAccess::Http(HttpAccess {
                        url: "https://example.com/audio?secret=hidden".into(),
                        headers: vec![],
                    }),
                })
            })
        }
    }
    fn source() -> SourceId {
        SourceId::try_from("test".to_owned()).unwrap()
    }
    fn reference_for(id: &str) -> EntityRef {
        EntityRef {
            source: source(),
            kind: EntityKind::Track,
            id: OpaqueId::try_from(id.to_owned()).unwrap(),
        }
    }
    fn adapter(blocked: bool) -> TestAdapter {
        TestAdapter {
            descriptor: SourceDescriptor {
                source: source(),
                display_name: "test".into(),
                contract_version: super::super::CONTRACT_VERSION,
                capabilities: Default::default(),
            },
            blocked,
            entered: Default::default(),
            calls: Default::default(),
            wrong_identity: false,
            expiry: None,
        }
    }
    fn setup(adapter: TestAdapter) -> (Arc<AdapterManager>, Arc<AtomicU64>, Arc<TestAdapter>) {
        let manager = Arc::new(AdapterManager::default());
        let generation = Arc::new(AtomicU64::new(0));
        let session_generation = generation.clone();
        let adapter = Arc::new(adapter);
        manager
            .register(
                adapter.clone(),
                Arc::new(move || SessionContext {
                    source: source(),
                    account: None,
                    generation: session_generation.load(Ordering::Acquire),
                }),
            )
            .unwrap();
        (manager, generation, adapter)
    }
    fn request() -> ResolveRequest {
        ResolveRequest {
            track: reference_for("A:non-numeric/01"),
            preferred_quality: "test".into(),
            allow_downgrade: false,
        }
    }

    #[tokio::test]
    async fn registry_validates_and_never_overwrites_a_source() {
        let (manager, _, provider) = setup(adapter(false));
        assert_eq!(
            manager
                .register(
                    provider,
                    Arc::new(|| SessionContext {
                        source: source(),
                        account: None,
                        generation: 0
                    })
                )
                .unwrap_err()
                .code,
            ErrorCode::InvalidData
        );
        let track = manager.read_track(&request().track).await.unwrap();
        assert_eq!(track.reference.id.as_str(), "A:non-numeric/01");
        manager.set_enabled(&source(), false).unwrap();
        assert_eq!(
            manager.read_track(&request().track).await.unwrap_err().code,
            ErrorCode::SourceUnavailable
        );
        manager.set_enabled(&source(), true).unwrap();
        manager.read_track(&request().track).await.unwrap();
        let mut malformed = adapter(false);
        malformed.wrong_identity = true;
        assert_eq!(
            setup(malformed)
                .0
                .read_track(&request().track)
                .await
                .unwrap_err()
                .code,
            ErrorCode::InvalidData
        );
    }
    #[tokio::test]
    async fn pending_queries_are_cancelled_without_adapter_cooperation() {
        for change in 0..3 {
            let (manager, session, adapter) = setup(adapter(true));
            let worker = manager.clone();
            let query = tokio::spawn(async move { worker.read_track(&request().track).await });
            adapter.entered.notified().await;
            let expected = match change {
                0 => {
                    manager.set_enabled(&source(), false).unwrap();
                    ErrorCode::SourceUnavailable
                }
                1 => {
                    session.fetch_add(1, Ordering::AcqRel);
                    ErrorCode::StaleContext
                }
                _ => {
                    manager.reload(&source()).unwrap();
                    ErrorCode::StaleContext
                }
            };
            let result = tokio::time::timeout(Duration::from_secs(1), query)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(result.unwrap_err().code, expected);
        }
    }
    #[tokio::test]
    async fn playback_has_a_reserved_budget_when_reads_are_full() {
        let (manager, _, adapter) = setup(adapter(true));
        let mut jobs = vec![];
        for _ in 0..4 {
            let worker = manager.clone();
            jobs.push(tokio::spawn(async move {
                worker.read_track(&request().track).await
            }));
            adapter.entered.notified().await;
        }
        assert_eq!(
            manager.read_track(&request().track).await.unwrap_err().code,
            ErrorCode::RateLimited
        );
        let resource = manager.resolve_playback(&request(), 7).await.unwrap();
        resource.check(7).unwrap();
        assert_eq!(resource.check(8).unwrap_err().code, ErrorCode::StaleContext);
        manager.set_enabled(&source(), false).unwrap();
        for job in jobs {
            assert_eq!(
                job.await.unwrap().unwrap_err().code,
                ErrorCode::SourceUnavailable
            );
        }
    }
    #[tokio::test]
    async fn deadline_and_explicit_cancellation_drop_pending_futures() {
        let (manager, _, _) = setup(adapter(false));
        let entry = manager.entry(&source()).unwrap();
        let context = AdapterManager::context(&entry, Duration::from_millis(20));
        let result = manager
            .run::<()>(&entry, &context, std::future::pending())
            .await;
        assert_eq!(result.unwrap_err().code, ErrorCode::DeadlineExceeded);
        let context = AdapterManager::context(&entry, Duration::from_secs(1));
        context.cancellation.cancel();
        assert_eq!(
            manager
                .run::<()>(&entry, &context, std::future::pending())
                .await
                .unwrap_err()
                .code,
            ErrorCode::Cancelled
        );
    }
    #[tokio::test]
    async fn resource_ownership_is_bounded_revocable_and_redacted() {
        let (manager, session, _) = setup(adapter(false));
        let mut resources = vec![];
        for _ in 0..16 {
            resources.push(manager.resolve_playback(&request(), 7).await.unwrap());
        }
        assert_eq!(
            manager
                .resolve_playback(&request(), 7)
                .await
                .unwrap_err()
                .code,
            ErrorCode::RateLimited
        );
        resources.pop();
        let ticket = manager.resolve_playback(&request(), 7).await.unwrap();
        assert!(!format!("{ticket:?}").contains("hidden"));
        session.fetch_add(1, Ordering::AcqRel);
        assert_eq!(ticket.check(7).unwrap_err().code, ErrorCode::StaleContext);
        manager.set_enabled(&source(), false).unwrap();
        assert_eq!(
            ticket.check(7).unwrap_err().code,
            ErrorCode::SourceUnavailable
        );
        manager.set_enabled(&source(), true).unwrap();
        assert_eq!(ticket.check(7).unwrap_err().code, ErrorCode::StaleContext);
    }
    #[tokio::test]
    async fn provider_expiry_is_checked_again_before_handoff() {
        let mut provider = adapter(false);
        provider.expiry = Some(now_ms() + 100);
        let (manager, _, _) = setup(provider);
        let resource = manager.resolve_playback(&request(), 7).await.unwrap();
        tokio::time::sleep(Duration::from_millis(120)).await;
        assert_eq!(
            resource.check(7).unwrap_err().code,
            ErrorCode::DeadlineExceeded
        );
        assert_eq!(
            manager
                .resolve_playback(&request(), 7)
                .await
                .unwrap_err()
                .code,
            ErrorCode::DeadlineExceeded
        );
    }
    #[test]
    fn unsafe_or_unimplemented_access_is_rejected() {
        for url in [
            "file:///tmp/music",
            "https://user:secret@example.com/a",
            "https://example.com/a#fragment",
        ] {
            assert_eq!(
                validate_access(&ResourceAccess::Http(HttpAccess {
                    url: url.into(),
                    headers: vec![]
                }))
                .unwrap_err()
                .code,
                ErrorCode::InvalidData
            );
        }
        assert_eq!(
            validate_access(&ResourceAccess::Http(HttpAccess {
                url: "https://example.com/a".into(),
                headers: vec![("Authorization".into(), "secret".into())]
            }))
            .unwrap_err()
            .code,
            ErrorCode::Unsupported
        );
    }
}
