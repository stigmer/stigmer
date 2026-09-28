//! Typed failures for the runner host.
//!
//! Replaces the desktop's stringly-typed `Result<_, String>`. The Tauri binding flattens
//! these back to `String` at its boundary (the JS frontend treats errors as strings).

use thiserror::Error;

/// Everything that can go wrong driving the runner subprocess.
#[derive(Debug, Error)]
pub enum RunnerHostError {
    #[error("runner is already running")]
    AlreadyRunning,

    #[error("runner is not running")]
    NotRunning,

    #[error(
        "runner entry `{entry}` does not exist (relative paths resolve against the working \
         directory `{cwd}`); pass an absolute path — a packaged app launched from the desktop \
         has working directory `/`, not your app's resource directory"
    )]
    RunnerEntryNotFound { entry: String, cwd: String },

    #[error(
        "extra_env key `{key}` is reserved: the host owns it{hint}",
        hint = typed_field_hint(.key)
    )]
    ReservedEnvKey { key: String },

    // The engine the host was told to run does not exist. Named apart from `Spawn` because it
    // is the failure every packaged GUI embedder meets first (stigmer/stigmer#1068), and the
    // bare "No such file or directory" it replaces says nothing about why.
    #[error("node binary `{node_binary}` was not found{hint}", hint = node_binary_hint(.searched_path))]
    NodeBinaryNotFound {
        node_binary: String,
        /// The PATH a bare name was looked up on; `None` when `node_binary` is a path.
        searched_path: Option<String>,
    },

    #[error("failed to spawn runner process: {0}")]
    Spawn(#[source] std::io::Error),

    #[error("runner IPC I/O failed: {0}")]
    Io(#[source] std::io::Error),

    #[error("failed to (de)serialize an IPC message: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("timed out waiting for the runner `ready` handshake")]
    ReadyTimeout,

    #[error("runner failed to start: {message}")]
    RunnerStartup { message: String },

    #[error("unexpected first message from runner (expected `ready`): {0}")]
    UnexpectedFirstMessage(String),

    // Host too old to understand the runner. The compatibility rule (integer bumps only on
    // breaking change) means only runner > host is incompatible; equal/lower is fine.
    #[error(
        "runner speaks IPC protocol v{runner}, but this host only understands v{host}; \
         upgrade the host"
    )]
    ProtocolVersionMismatch { host: u32, runner: u32 },
}

impl RunnerHostError {
    /// A child pipe (stdin/stdout/stderr) could not be captured after spawn.
    pub(crate) fn pipe(which: &str) -> Self {
        RunnerHostError::Io(std::io::Error::new(
            std::io::ErrorKind::BrokenPipe,
            format!("failed to capture runner {which}"),
        ))
    }
}

// Says why a node binary was not found and what to pass instead. A bare name is resolved on
// the host's PATH, which is the shell's only when the host was started from one.
fn node_binary_hint(searched_path: &Option<String>) -> String {
    match searched_path {
        Some(path) => format!(
            ": a bare name is looked up on this process's PATH (`{path}`), and an app launched \
             from Finder, the Dock or the Start menu does not inherit the shell's PATH; pass an \
             absolute path in `node_binary`, ideally to a Node runtime your app ships (see the \
             runner embedding guide)"
        ),
        None => "; no file exists at that path; pass the absolute path of an existing Node binary"
            .to_string(),
    }
}

// Points a rejected reserved key at the typed `RunnerConfig` field that sets it, so the
// error is actionable without reading crate source.
fn typed_field_hint(key: &str) -> &'static str {
    match key {
        "ANTHROPIC_API_KEY" => "; use the `anthropic_api_key` field instead",
        "OPENAI_API_KEY" => "; use the `openai_api_key` field instead",
        "STIGMER_TOKEN" => "; use the `stigmer_token` field instead",
        "CURSOR_API_KEY" => "; use the `cursor_api_key` field instead",
        "TEMPORAL_SERVICE_ADDRESS" => "; use the `temporal_address` field instead",
        "TEMPORAL_NAMESPACE" => "; use the `temporal_namespace` field instead",
        "STIGMER_BACKEND_ENDPOINT" => "; use the `stigmer_endpoint` field instead",
        "WORKSPACE_ROOT_DIR" => "; use the `workspace_root_dir` field instead",
        "STIGMER_PROXY_ENDPOINT" => "; use the `proxy_endpoint` field instead",
        _ => "",
    }
}
