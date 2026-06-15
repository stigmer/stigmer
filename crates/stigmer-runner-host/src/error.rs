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
