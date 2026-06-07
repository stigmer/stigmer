//! `RunnerHost` — the framework-agnostic driver for a manager-mode runner subprocess.
//!
//! Spawns the Node runner with `STIGMER_RUNNER_MODE=manager`, performs the versioned
//! `ready` handshake, and drives the stdin/stdout JSON IPC. Drives commands
//! fire-and-forget (write + track intended state locally) — the style the IPC spec
//! documents for the desktop host; it does not correlate acks.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use crate::config::RunnerConfig;
use crate::error::RunnerHostError;
use crate::protocol::{IpcCommand, IpcResponse, IPC_PROTOCOL_VERSION};

/// Sink for runner log lines (forwarded stderr + IPC diagnostics). A callback keeps the
/// core free of a logging-framework dependency; the default prints to stderr.
pub type LogSink = Arc<dyn Fn(String) + Send + Sync>;

/// Snapshot of the runner's lifecycle state. Framework-free; the Tauri binding maps it to
/// its own camelCase response shape.
#[derive(Debug, Clone)]
pub struct RunnerStatus {
    pub running: bool,
    pub active_sessions: Vec<String>,
    pub active_workflow_executions: Vec<String>,
}

/// A live runner subprocess plus the host's view of what it is working on.
struct RunnerProcess {
    child: Child,
    stdin: tokio::process::ChildStdin,
    active_sessions: HashSet<String>,
    active_workflow_executions: HashSet<String>,
}

impl RunnerProcess {
    /// Write one newline-delimited JSON command to the runner's stdin.
    async fn send(&mut self, command: &IpcCommand) -> Result<(), RunnerHostError> {
        let line = serde_json::to_string(command)?;
        self.stdin
            .write_all(format!("{line}\n").as_bytes())
            .await
            .map_err(RunnerHostError::Io)?;
        // Best-effort flush: a failure here surfaces on the next write or process exit.
        self.stdin.flush().await.ok();
        Ok(())
    }
}

/// Embeds and drives a single runner subprocess. Cheap to clone the internal handle for
/// background tasks; the public type holds the owned state.
pub struct RunnerHost {
    process: Arc<Mutex<Option<RunnerProcess>>>,
    log: LogSink,
}

impl Default for RunnerHost {
    fn default() -> Self {
        Self::new()
    }
}

impl RunnerHost {
    /// New host that forwards runner logs to stderr.
    pub fn new() -> Self {
        Self::with_log_sink(Arc::new(|line| eprintln!("{line}")))
    }

    /// New host with a custom log sink (e.g. to route runner logs into a host's logger).
    pub fn with_log_sink(log: LogSink) -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            log,
        }
    }

    /// Spawn the runner, await the `ready` handshake, and negotiate the protocol version.
    pub async fn start(&self, config: RunnerConfig) -> Result<(), RunnerHostError> {
        let mut guard = self.process.lock().await;
        if guard.is_some() {
            return Err(RunnerHostError::AlreadyRunning);
        }

        let mut cmd = Command::new(&config.node_binary);
        cmd.arg(&config.runner_entry);
        cmd.envs(build_env(&config));

        cmd.stdin(std::process::Stdio::piped());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        let mut child = cmd.spawn().map_err(RunnerHostError::Spawn)?;
        let stdin = child.stdin.take().ok_or_else(|| RunnerHostError::pipe("stdin"))?;
        let stdout = child.stdout.take().ok_or_else(|| RunnerHostError::pipe("stdout"))?;

        if let Some(stderr) = child.stderr.take() {
            let log = self.log.clone();
            tokio::spawn(async move {
                let reader = BufReader::new(stderr);
                let mut lines = reader.lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    log(format!("[runner-stderr] {line}"));
                }
            });
        }

        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .await
            .map_err(RunnerHostError::Io)?;

        match negotiate_ready(line.trim()) {
            Ok(version) => (self.log)(format!("[runner-ipc] ready (protocolVersion={version})")),
            Err(err) => {
                // The handshake failed (bad version, startup error, or junk): the child is
                // unusable, so reap it before surfacing the typed error.
                let _ = child.kill().await;
                return Err(err);
            }
        }

        // Background reader: the fire-and-forget driver tracks state locally, so it only
        // needs to log responses and tear down on a fatal error.
        let process_arc = self.process.clone();
        let log = self.log.clone();
        tokio::spawn(async move {
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let Ok(resp) = serde_json::from_str::<IpcResponse>(&line) else {
                    continue;
                };
                match resp {
                    IpcResponse::Error { message, fatal } => {
                        log(format!("[runner-ipc] Error: {message} (fatal={fatal})"));
                        if fatal {
                            *process_arc.lock().await = None;
                            break;
                        }
                    }
                    _ => log(format!("[runner-ipc] Response: {line}")),
                }
            }
        });

        *guard = Some(RunnerProcess {
            child,
            stdin,
            active_sessions: HashSet::new(),
            active_workflow_executions: HashSet::new(),
        });
        Ok(())
    }

    /// Ask the runner to shut down, then wait (bounded) for the process to exit.
    pub async fn stop(&self) -> Result<(), RunnerHostError> {
        let mut guard = self.process.lock().await;
        let proc = guard.as_mut().ok_or(RunnerHostError::NotRunning)?;
        proc.send(&IpcCommand::Shutdown).await?;
        // Bounded wait: if the runner ignores shutdown we still drop our handle rather than
        // block the host forever.
        let _ = tokio::time::timeout(Duration::from_secs(10), proc.child.wait()).await;
        *guard = None;
        Ok(())
    }

    /// Start a worker for a session. Idempotent: a no-op (ack) if already active.
    pub async fn add_session(&self, session_id: &str) -> Result<(), RunnerHostError> {
        let mut guard = self.process.lock().await;
        let proc = guard.as_mut().ok_or(RunnerHostError::NotRunning)?;
        if proc.active_sessions.contains(session_id) {
            return Ok(());
        }
        proc.send(&IpcCommand::AddSession {
            session_id: session_id.to_string(),
        })
        .await?;
        proc.active_sessions.insert(session_id.to_string());
        Ok(())
    }

    /// Stop a session's worker. Idempotent: a no-op if not active.
    pub async fn remove_session(&self, session_id: &str) -> Result<(), RunnerHostError> {
        let mut guard = self.process.lock().await;
        let proc = guard.as_mut().ok_or(RunnerHostError::NotRunning)?;
        if !proc.active_sessions.contains(session_id) {
            return Ok(());
        }
        proc.send(&IpcCommand::RemoveSession {
            session_id: session_id.to_string(),
        })
        .await?;
        proc.active_sessions.remove(session_id);
        Ok(())
    }

    /// Start a worker for a workflow execution. Idempotent: a no-op if already active.
    pub async fn add_workflow_execution(&self, execution_id: &str) -> Result<(), RunnerHostError> {
        let mut guard = self.process.lock().await;
        let proc = guard.as_mut().ok_or(RunnerHostError::NotRunning)?;
        if proc.active_workflow_executions.contains(execution_id) {
            return Ok(());
        }
        proc.send(&IpcCommand::AddWorkflowExecution {
            execution_id: execution_id.to_string(),
        })
        .await?;
        proc.active_workflow_executions
            .insert(execution_id.to_string());
        Ok(())
    }

    /// Stop a workflow execution's worker. Idempotent: a no-op if not active.
    pub async fn remove_workflow_execution(
        &self,
        execution_id: &str,
    ) -> Result<(), RunnerHostError> {
        let mut guard = self.process.lock().await;
        let proc = guard.as_mut().ok_or(RunnerHostError::NotRunning)?;
        if !proc.active_workflow_executions.contains(execution_id) {
            return Ok(());
        }
        proc.send(&IpcCommand::RemoveWorkflowExecution {
            execution_id: execution_id.to_string(),
        })
        .await?;
        proc.active_workflow_executions.remove(execution_id);
        Ok(())
    }

    /// Push a new (or cleared) auth token to the running runner.
    pub async fn update_token(&self, token: Option<String>) -> Result<(), RunnerHostError> {
        let mut guard = self.process.lock().await;
        let proc = guard.as_mut().ok_or(RunnerHostError::NotRunning)?;
        proc.send(&IpcCommand::UpdateToken { token }).await?;
        Ok(())
    }

    /// Current lifecycle snapshot (running flag + active sessions/executions).
    pub async fn status(&self) -> RunnerStatus {
        let guard = self.process.lock().await;
        match guard.as_ref() {
            Some(proc) => RunnerStatus {
                running: true,
                active_sessions: proc.active_sessions.iter().cloned().collect(),
                active_workflow_executions: proc
                    .active_workflow_executions
                    .iter()
                    .cloned()
                    .collect(),
            },
            None => RunnerStatus {
                running: false,
                active_sessions: Vec::new(),
                active_workflow_executions: Vec::new(),
            },
        }
    }
}

/// Parse the runner's first stdout line and reconcile its protocol version against ours.
///
/// A pure seam (no process, no I/O) so version negotiation is unit-testable directly.
/// Returns the runner's effective version on success. The rule: a runner version greater
/// than ours is incompatible (we are too old to understand it); equal or lower is fine
/// because additive changes never bump the version.
fn negotiate_ready(line: &str) -> Result<u32, RunnerHostError> {
    match serde_json::from_str::<IpcResponse>(line)? {
        IpcResponse::Ready { protocol_version } => {
            let runner = protocol_version.unwrap_or(1);
            if runner > IPC_PROTOCOL_VERSION {
                return Err(RunnerHostError::ProtocolVersionMismatch {
                    host: IPC_PROTOCOL_VERSION,
                    runner,
                });
            }
            Ok(runner)
        }
        IpcResponse::Error { message, .. } => Err(RunnerHostError::RunnerStartup { message }),
        other => Err(RunnerHostError::UnexpectedFirstMessage(format!("{other:?}"))),
    }
}

/// Build the environment the runner subprocess inherits from a [`RunnerConfig`].
///
/// Pure and total (no process, no I/O) so the env mapping is unit-testable. The
/// runner always runs in manager mode here. `TEMPORAL_SERVICE_ADDRESS` is set
/// only when the host provides an address: omitting it is the token-only
/// embedding path, where the runner self-discovers Temporal from the control
/// plane using `STIGMER_TOKEN`.
fn build_env(config: &RunnerConfig) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = vec![
        ("STIGMER_RUNNER_MODE".to_string(), "manager".to_string()),
        (
            "STIGMER_BACKEND_ENDPOINT".to_string(),
            config.stigmer_endpoint.clone(),
        ),
    ];

    if let Some(addr) = &config.temporal_address {
        env.push(("TEMPORAL_SERVICE_ADDRESS".to_string(), addr.clone()));
    }
    if let Some(ns) = &config.temporal_namespace {
        env.push(("TEMPORAL_NAMESPACE".to_string(), ns.clone()));
    }
    if let Some(token) = &config.stigmer_token {
        env.push(("STIGMER_TOKEN".to_string(), token.clone()));
    }
    if let Some(key) = &config.cursor_api_key {
        env.push(("CURSOR_API_KEY".to_string(), key.clone()));
    }
    if let Some(dir) = &config.workspace_root_dir {
        env.push(("WORKSPACE_ROOT_DIR".to_string(), dir.clone()));
    }
    if let Some(proxy) = &config.proxy_endpoint {
        env.push(("STIGMER_PROXY_ENDPOINT".to_string(), proxy.clone()));
        // The runner's Cursor SDK negotiates HTTP/2 over TLS; a self-signed local
        // proxy would otherwise fail the TLS handshake.
        if proxy.starts_with("https://") {
            env.push(("NODE_TLS_REJECT_UNAUTHORIZED".to_string(), "0".to_string()));
        }
    }

    env
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ready_with_current_version_is_accepted() {
        let version = negotiate_ready(r#"{"type":"ready","protocolVersion":1}"#).unwrap();
        assert_eq!(version, IPC_PROTOCOL_VERSION);
    }

    #[test]
    fn ready_without_version_defaults_to_one() {
        let version = negotiate_ready(r#"{"type":"ready"}"#).unwrap();
        assert_eq!(version, 1, "absent protocolVersion is treated as v1");
    }

    #[test]
    fn newer_runner_is_rejected_as_mismatch() {
        // This is the negotiation guard: removing it would let a newer runner through.
        let err = negotiate_ready(r#"{"type":"ready","protocolVersion":2}"#).unwrap_err();
        match err {
            RunnerHostError::ProtocolVersionMismatch { host, runner } => {
                assert_eq!(host, IPC_PROTOCOL_VERSION);
                assert_eq!(runner, 2);
            }
            other => panic!("expected ProtocolVersionMismatch, got {other:?}"),
        }
    }

    #[test]
    fn startup_error_surfaces_as_runner_startup() {
        let err =
            negotiate_ready(r#"{"type":"error","message":"bad config","fatal":true}"#).unwrap_err();
        match err {
            RunnerHostError::RunnerStartup { message } => assert_eq!(message, "bad config"),
            other => panic!("expected RunnerStartup, got {other:?}"),
        }
    }

    #[test]
    fn non_ready_first_message_is_unexpected() {
        let err =
            negotiate_ready(r#"{"type":"sessionAdded","sessionId":"s","taskQueue":"q"}"#)
                .unwrap_err();
        assert!(matches!(err, RunnerHostError::UnexpectedFirstMessage(_)));
    }

    fn env_value<'a>(env: &'a [(String, String)], key: &str) -> Option<&'a str> {
        env.iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_str())
    }

    fn minimal_config() -> RunnerConfig {
        RunnerConfig {
            node_binary: "node".to_string(),
            runner_entry: "main.js".to_string(),
            temporal_address: None,
            stigmer_endpoint: "https://api.stigmer.ai".to_string(),
            temporal_namespace: None,
            stigmer_token: Some("tok".to_string()),
            cursor_api_key: None,
            workspace_root_dir: None,
            proxy_endpoint: None,
        }
    }

    #[test]
    fn build_env_omits_temporal_address_for_token_only_embedding() {
        // The whole point of token-only embedding: when the host gives no address,
        // the runner must NOT receive TEMPORAL_SERVICE_ADDRESS so it self-discovers.
        let env = build_env(&minimal_config());

        assert_eq!(env_value(&env, "TEMPORAL_SERVICE_ADDRESS"), None);
        assert_eq!(env_value(&env, "STIGMER_RUNNER_MODE"), Some("manager"));
        assert_eq!(
            env_value(&env, "STIGMER_BACKEND_ENDPOINT"),
            Some("https://api.stigmer.ai")
        );
        assert_eq!(env_value(&env, "STIGMER_TOKEN"), Some("tok"));
    }

    #[test]
    fn build_env_sets_temporal_address_when_provided() {
        let mut config = minimal_config();
        config.temporal_address = Some("temporal.example:7233".to_string());

        let env = build_env(&config);

        assert_eq!(
            env_value(&env, "TEMPORAL_SERVICE_ADDRESS"),
            Some("temporal.example:7233")
        );
    }

    #[test]
    fn build_env_relaxes_tls_only_for_https_proxy() {
        let mut config = minimal_config();
        config.proxy_endpoint = Some("https://localhost:9093".to_string());
        let env = build_env(&config);
        assert_eq!(env_value(&env, "NODE_TLS_REJECT_UNAUTHORIZED"), Some("0"));

        config.proxy_endpoint = Some("http://proxy:8080".to_string());
        let env = build_env(&config);
        assert_eq!(env_value(&env, "NODE_TLS_REJECT_UNAUTHORIZED"), None);
    }
}
