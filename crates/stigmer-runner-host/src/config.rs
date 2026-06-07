//! Configuration for spawning the runner subprocess.
//!
//! Idiomatic snake_case Rust — no JS/camelCase shapes. A host loading config from
//! TOML/JSON or building it in code uses this directly; the Tauri binding maps its
//! camelCase JS input onto it (see the `tauri` module).

use serde::Deserialize;

/// Inputs the host supplies to launch the runner. The crate does not bundle the Node
/// runner; the embedder points `node_binary` + `runner_entry` at an installed
/// `@stigmer/runner` and supplies the endpoints its deployment needs.
#[derive(Debug, Clone, Deserialize)]
pub struct RunnerConfig {
    pub node_binary: String,
    pub runner_entry: String,
    /// Temporal frontend address. `None` enables token-only embedding: the runner
    /// self-discovers the address from the control plane during boot using
    /// `stigmer_token`. Provide it to bypass discovery — an explicit value wins.
    pub temporal_address: Option<String>,
    pub stigmer_endpoint: String,
    pub temporal_namespace: Option<String>,
    pub stigmer_token: Option<String>,
    pub cursor_api_key: Option<String>,
    // Resolved working directory for the runner. The core forwards it as-is; deriving a
    // default (e.g. a desktop's ~/.stigmer path) is host policy and lives in the binding.
    pub workspace_root_dir: Option<String>,
    pub proxy_endpoint: Option<String>,
}
