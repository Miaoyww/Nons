//! Functional-plugin capability binding to the shared backend Component executor.
use super::capability::Context;
pub(crate) use crate::wasm_runtime::{engine, Runtime};
use crate::{model::AppResult, wasm_runtime::HostHandler};
use std::{future::Future, path::Path, pin::Pin, sync::Arc};
use wasmtime::Engine;

impl HostHandler for Context {
    fn call<'a>(
        &'a self,
        operation: &'a str,
        args: &'a str,
    ) -> Pin<Box<dyn Future<Output = AppResult<String>> + Send + 'a>> {
        Box::pin(Context::call(self, operation, args))
    }
}
impl Runtime {
    pub async fn load(engine: Engine, path: &Path, context: Context) -> AppResult<Self> {
        Self::load_host(engine, path, Arc::new(context)).await
    }
}
