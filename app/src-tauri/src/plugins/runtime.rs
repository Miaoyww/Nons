use super::capability::{Context, MAX_JSON};
use crate::model::AppResult;
use std::{future::Future, path::Path, pin::Pin, sync::Arc, time::Duration};
use wasmtime::{
    component::{Component, Linker},
    Config, Engine, Store, StoreLimits, StoreLimitsBuilder,
};

wasmtime::component::bindgen!({
    path: "../../plugins/wit",
    world: "plugin",
    imports: { default: async },
    exports: { default: async },
});

trait HostHandler: Send + Sync {
    fn call<'a>(
        &'a self,
        operation: &'a str,
        args: &'a str,
    ) -> Pin<Box<dyn Future<Output = AppResult<String>> + Send + 'a>>;
}

impl HostHandler for Context {
    fn call<'a>(
        &'a self,
        operation: &'a str,
        args: &'a str,
    ) -> Pin<Box<dyn Future<Output = AppResult<String>> + Send + 'a>> {
        Box::pin(Context::call(self, operation, args))
    }
}
struct State {
    host: Arc<dyn HostHandler>,
    limits: StoreLimits,
}
impl nons::plugin::host::Host for State {
    async fn call(&mut self, operation: String, args: String) -> Result<String, String> {
        self.host.call(&operation, &args).await
    }
}
pub fn engine() -> AppResult<Engine> {
    let mut config = Config::new();
    config
        .wasm_component_model(true)
        .consume_fuel(true)
        .epoch_interruption(true);
    Engine::new(&config).map_err(|e| e.to_string())
}
pub struct Runtime {
    store: Store<State>,
    bindings: Plugin,
    pub faulted: bool,
}
impl Runtime {
    pub async fn load(engine: Engine, path: &Path, context: Context) -> AppResult<Self> {
        Self::load_host(engine, path, Arc::new(context)).await
    }
    async fn load_host(engine: Engine, path: &Path, host: Arc<dyn HostHandler>) -> AppResult<Self> {
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        if bytes.len() > 16 * 1024 * 1024 {
            return Err("WASM 入口过大".into());
        }
        let compile_engine = engine.clone();
        let component =
            tauri::async_runtime::spawn_blocking(move || Component::new(&compile_engine, bytes))
                .await
                .map_err(|e| e.to_string())?
                .map_err(|e| format!("无效 WASM Component: {e}"))?;
        let mut linker = Linker::<State>::new(&engine);
        // Only our WIT imports are linked: no WASI filesystem, network or process APIs.
        Plugin::add_to_linker::<_, wasmtime::component::HasSelf<State>>(&mut linker, |state| state)
            .map_err(|e| e.to_string())?;
        let limits = StoreLimitsBuilder::new()
            .memory_size(64 * 1024 * 1024)
            .table_elements(10000)
            .instances(16)
            .memories(1)
            .tables(8)
            .trap_on_grow_failure(true)
            .build();
        let mut store = Store::new(&engine, State { host, limits });
        store.limiter(|state| &mut state.limits);
        store.set_fuel(10_000_000).map_err(|e| e.to_string())?;
        store
            .fuel_async_yield_interval(Some(10000))
            .map_err(|e| e.to_string())?;
        store.set_epoch_deadline(500);
        let bindings = tokio::time::timeout(
            Duration::from_secs(5),
            Plugin::instantiate_async(&mut store, &component, &linker),
        )
        .await
        .map_err(|_| "WASM 实例化超时")?
        .map_err(|e| e.to_string())?;
        let mut runtime = Self {
            store,
            bindings,
            faulted: false,
        };
        runtime.reset_budget()?;
        tokio::time::timeout(
            Duration::from_secs(5),
            runtime.bindings.call_initialize(&mut runtime.store),
        )
        .await
        .map_err(|_| "插件初始化超时")?
        .map_err(|e| e.to_string())??;
        Ok(runtime)
    }
    fn reset_budget(&mut self) -> AppResult<()> {
        self.store.set_fuel(10_000_000).map_err(|e| e.to_string())?;
        self.store.set_epoch_deadline(500);
        Ok(())
    }
    pub async fn call(&mut self, method: &str, args: &str) -> AppResult<String> {
        if method.len() > 128 || args.len() > MAX_JSON {
            return Err("插件调用过大".into());
        }
        self.reset_budget()?;
        let outcome = tokio::time::timeout(
            Duration::from_secs(5),
            self.bindings.call_call(&mut self.store, method, args),
        )
        .await;
        let result = match outcome {
            Ok(Ok(result)) => result?,
            Ok(Err(error)) => {
                self.faulted = true;
                return Err(format!("插件执行失败: {error}"));
            }
            Err(_) => {
                self.faulted = true;
                return Err("插件执行超时".into());
            }
        };
        if result.len() > MAX_JSON {
            self.faulted = true;
            return Err("插件响应过大".into());
        }
        if serde_json::from_str::<serde_json::Value>(&result).is_err() {
            self.faulted = true;
            return Err("插件返回了无效 JSON".into());
        }
        Ok(result)
    }
    pub async fn shutdown(&mut self) {
        if self.reset_budget().is_ok() {
            let _ = tokio::time::timeout(
                Duration::from_secs(1),
                self.bindings.call_shutdown(&mut self.store),
            )
            .await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;
    #[derive(Default)]
    struct FakeHost {
        events: Mutex<Vec<serde_json::Value>>,
    }
    impl HostHandler for FakeHost {
        fn call<'a>(
            &'a self,
            operation: &'a str,
            args: &'a str,
        ) -> Pin<Box<dyn Future<Output = AppResult<String>> + Send + 'a>> {
            Box::pin(async move {
                match operation {
                    "music.get-song" => {
                        let args: serde_json::Value = serde_json::from_str(args).unwrap();
                        assert_eq!(args["id"], 347230);
                        Ok(serde_json::json!({"id":347230,"title":"Fixture song","artist":"Fixture artist","album":"Fixture album","durationMs":1000,"cover":""}).to_string())
                    }
                    "events.emit" => {
                        self.events
                            .lock()
                            .unwrap()
                            .push(serde_json::from_str(args).unwrap());
                        Ok("null".into())
                    }
                    "wait" => {
                        tokio::time::sleep(Duration::from_secs(30)).await;
                        Ok("null".into())
                    }
                    _ => Err("permission denied".into()),
                }
            })
        }
    }
    fn fixture(name: &str) -> std::path::PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join(format!(
            "../../plugins/{name}/backend/target/wasm32-unknown-unknown/release/{}.wasm",
            name.replace('-', "_")
        ))
    }
    fn run(future: impl Future<Output = ()>) {
        tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap()
            .block_on(future);
    }
    #[test]
    fn actual_island_component_calls_host_and_emits_song() {
        run(async {
            let host = Arc::new(FakeHost::default());
            let mut runtime =
                Runtime::load_host(engine().unwrap(), &fixture("netease-island"), host.clone())
                    .await
                    .expect("Run pnpm plugins:build before Rust tests");
            assert_eq!(
                runtime
                    .call(
                        "event:music-link",
                        r#"{"url":"https://music.163.com/#/song?id=347230"}"#
                    )
                    .await
                    .unwrap(),
                "null"
            );
            {
                let events = host.events.lock().unwrap();
                assert_eq!(events.len(), 1);
                assert_eq!(events[0]["event"], "song-detected");
                assert_eq!(events[0]["payload"]["title"], "Fixture song");
            }
            assert!(runtime.call("unknown", "null").await.is_err());
            assert!(
                !runtime.faulted,
                "guest business errors preserve the instance"
            );
            runtime.shutdown().await;
        });
    }
    #[test]
    fn fuel_memory_trap_and_invalid_results_are_isolated() {
        run(async {
            let engine = engine().unwrap();
            for method in ["loop", "memory", "trap", "invalid-json"] {
                let mut runtime = Runtime::load_host(
                    engine.clone(),
                    &fixture("runtime-fixture"),
                    Arc::new(FakeHost::default()),
                )
                .await
                .expect("Run pnpm plugins:fixtures before Rust tests");
                assert!(runtime.call(method, "null").await.is_err(), "{method}");
                assert!(runtime.faulted, "{method}");
                let mut healthy = Runtime::load_host(
                    engine.clone(),
                    &fixture("runtime-fixture"),
                    Arc::new(FakeHost::default()),
                )
                .await
                .unwrap();
                assert_eq!(healthy.call("healthy", "null").await.unwrap(), "null");
            }
        });
    }
    #[test]
    fn wall_timeout_cancels_async_host_wait() {
        run(async {
            let mut runtime = Runtime::load_host(
                engine().unwrap(),
                &fixture("runtime-fixture"),
                Arc::new(FakeHost::default()),
            )
            .await
            .unwrap();
            let started = std::time::Instant::now();
            assert!(runtime
                .call("host-wait", "null")
                .await
                .unwrap_err()
                .contains("超时"));
            assert!(runtime.faulted);
            assert!(started.elapsed() < Duration::from_secs(7));
        });
    }
}
