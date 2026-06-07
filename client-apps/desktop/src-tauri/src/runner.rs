//! Embedded runner lifecycle — thin binding over the `stigmer-runner-host` crate.
//!
//! The driver (spawn, versioned `ready` handshake, IPC, shutdown) lives in the reusable
//! `stigmer-runner-host` crate; this file only re-exports its Tauri command surface so
//! `lib.rs` registration and the frontend's command names stay unchanged.
//!
//! Glob (not named) re-export is deliberate: `#[tauri::command]` generates a hidden
//! `__cmd__*` ident that `generate_handler!` resolves by path, and only a glob `pub use`
//! carries it alongside the function.

pub use stigmer_runner_host::tauri::*;
