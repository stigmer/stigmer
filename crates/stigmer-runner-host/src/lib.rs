//! Embed the Stigmer runner as a manager-mode subprocess over its stdin/stdout JSON IPC.
//!
//! [`RunnerHost`] is the framework-agnostic driver: it spawns the Node runner with
//! `STIGMER_RUNNER_MODE=manager`, performs the versioned `ready` handshake, and exposes an
//! async lifecycle (`add_session`/`remove_session`,
//! `add_workflow_execution`/`remove_workflow_execution`, `update_token`, `stop`, `status`).
//! It has no Tauri dependency in the default build.
//!
//! Enable the `tauri` feature for the desktop binding — a `RunnerState` plus the
//! `#[tauri::command]` surface in [`tauri`].
//!
//! ```no_run
//! # async fn demo() -> Result<(), stigmer_runner_host::RunnerHostError> {
//! use stigmer_runner_host::{RunnerHost, RunnerConfig};
//!
//! let host = RunnerHost::new();
//! host.start(RunnerConfig {
//!     node_binary: "node".into(),
//!     runner_entry: "resources/runner/dist/main.js".into(),
//!     temporal_address: "localhost:7233".into(),
//!     stigmer_endpoint: "http://localhost:7234".into(),
//!     temporal_namespace: None,
//!     stigmer_token: None,
//!     cursor_api_key: None,
//!     workspace_root_dir: None,
//!     proxy_endpoint: None,
//! })
//! .await?;
//! host.add_session("ses_abc123").await?;
//! host.stop().await?;
//! # Ok(())
//! # }
//! ```
//!
//! This crate is a hand-maintained mirror of
//! `backend/services/runner/src/ipc-protocol.ts`. See the IPC spec at
//! <https://stigmer.ai/docs/guides/runners/ipc-protocol>.

mod config;
mod error;
mod host;
mod protocol;

pub use config::RunnerConfig;
pub use error::RunnerHostError;
pub use host::{LogSink, RunnerHost, RunnerStatus};
pub use protocol::IPC_PROTOCOL_VERSION;

#[cfg(feature = "tauri")]
pub mod tauri;
