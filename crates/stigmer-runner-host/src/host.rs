//! `RunnerHost` — the framework-agnostic driver for a manager-mode runner subprocess.
//!
//! Spawns the Node runner with `STIGMER_RUNNER_MODE=manager`, performs the versioned
//! `ready` handshake, and drives the stdin/stdout JSON IPC. Drives commands
//! fire-and-forget (write + track intended state locally) — the style the IPC spec
//! documents for the desktop host; it does not correlate acks.

use std::collections::HashSet;
use std::ops::ControlFlow;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncWriteExt, BufReader};
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
    /// OS process id of the runner, for embedders that want an out-of-band reaper. `Some`
    /// while the child is running, `None` when no runner is running (or once it has been
    /// reaped). Prefer `kill()` over killing this pid yourself unless you must reap from
    /// outside the host's lifetime (issue #177).
    pub pid: Option<u32>,
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

        // Fail fast on an unresolvable runner entry. `node` is given this path as an
        // argument and resolves it against the process working directory, which for a
        // Finder/dock-launched GUI app is `/` — so a relative entry that works under
        // `tauri dev` silently breaks once packaged. Without this guard the failure
        // would surface much later as an opaque EOF/serde error on the `ready` line,
        // long after the real cause.
        validate_runner_entry(&config.runner_entry)?;
        // Fail fast on extra_env entries that shadow host-owned keys, for the same
        // reason: a silently-clobbered STIGMER_TOKEN or TEMPORAL_NAMESPACE would
        // surface as a confusing runtime failure far from the misconfiguration.
        validate_extra_env(&config)?;

        let mut cmd = Command::new(&config.node_binary);
        cmd.arg(&config.runner_entry);
        cmd.envs(build_env(&config));

        cmd.stdin(std::process::Stdio::piped());
        cmd.stdout(std::process::Stdio::piped());
        cmd.stderr(std::process::Stdio::piped());

        // Tie the runner's lifetime to this handle: when the host drops `RunnerHost` (clean
        // app exit, `stop()`, or a panic that unwinds), the child is killed instead of
        // surviving as an orphan reparented to pid 1 (issue #177). This only covers paths
        // where Drop runs; a hard crash of the host is covered by the runner self-exiting on
        // stdin EOF (its IPC read loop ends when the parent's write end closes).
        cmd.kill_on_drop(true);

        let mut child = cmd.spawn().map_err(RunnerHostError::Spawn)?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| RunnerHostError::pipe("stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| RunnerHostError::pipe("stdout"))?;

        if let Some(stderr) = child.stderr.take() {
            let log = self.log.clone();
            tokio::spawn(async move {
                forward_lines(BufReader::new(stderr), |line| {
                    log(format!("[runner-stderr] {line}"));
                    ControlFlow::Continue(())
                })
                .await;
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
            let mut fatal = false;
            forward_lines(reader, |line| {
                let Ok(resp) = serde_json::from_str::<IpcResponse>(&line) else {
                    // Non-JSON lines are not IPC responses (e.g. stray diagnostics); skip them.
                    return ControlFlow::Continue(());
                };
                match resp {
                    IpcResponse::Error {
                        message,
                        fatal: is_fatal,
                    } => {
                        log(format!("[runner-ipc] Error: {message} (fatal={is_fatal})"));
                        if is_fatal {
                            fatal = true;
                            return ControlFlow::Break(());
                        }
                        ControlFlow::Continue(())
                    }
                    _ => {
                        log(format!("[runner-ipc] Response: {line}"));
                        ControlFlow::Continue(())
                    }
                }
            })
            .await;

            // Drop our handle so `status()` reflects a dead runner. Hoisted out of the
            // line callback because the lock acquisition must await — the callback is
            // intentionally synchronous (see `forward_lines`).
            if fatal {
                *process_arc.lock().await = None;
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

    /// Ask the runner to shut down, then wait (bounded) for the process to exit, escalating to
    /// a force-kill if it does not.
    pub async fn stop(&self) -> Result<(), RunnerHostError> {
        let mut guard = self.process.lock().await;
        let proc = guard.as_mut().ok_or(RunnerHostError::NotRunning)?;
        proc.send(&IpcCommand::Shutdown).await?;
        // A healthy runner exits on the IPC shutdown well within the grace period. If it does
        // not, it is wedged (busy-looping, not reading stdin) and will ignore SIGTERM too — so
        // SIGKILL and reap it rather than dropping a live handle and trusting `kill_on_drop`,
        // which is only a soft guarantee here (see `force_kill_and_reap`). Issue #177.
        if tokio::time::timeout(Duration::from_secs(10), proc.child.wait())
            .await
            .is_err()
        {
            (self.log)("[runner-ipc] shutdown grace expired; force-killing wedged runner".into());
            force_kill_and_reap(&mut proc.child).await;
        }
        *guard = None;
        Ok(())
    }

    /// Force-kill the runner now (SIGKILL) and drop the handle, skipping the graceful IPC
    /// shutdown. Idempotent: a no-op if nothing is running, so a host's app-exit reaper can
    /// always call it safely. Prefer `stop()` for normal shutdown; reach for this when the
    /// runner must die immediately and there is no time (or no point) draining it (issue #177).
    pub async fn kill(&self) {
        // Take the handle out under the lock, then release the lock before the (brief) reap
        // await so a concurrent `status()` is never blocked behind the kill.
        let proc = self.process.lock().await.take();
        if let Some(mut proc) = proc {
            force_kill_and_reap(&mut proc.child).await;
        }
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
                // `None` once tokio has reaped the child even if our handle lingers briefly.
                pid: proc.child.id(),
            },
            None => RunnerStatus {
                running: false,
                active_sessions: Vec::new(),
                active_workflow_executions: Vec::new(),
                pid: None,
            },
        }
    }
}

/// SIGKILL the child and reap it so a wedged or abandoned runner cannot linger as an
/// orphan/zombie. Best-effort: a child that already exited makes both calls no-ops.
///
/// Shared by `stop()` (escalation when graceful shutdown times out) and `kill()` (immediate
/// teardown). `kill_on_drop(true)` is a last-resort net for panic/unwind paths, but it is a
/// *soft* guarantee here — the background stdout reader holds an `Arc` clone of the process
/// handle, so the `Child` is not dropped (and SIGKILL not sent) until that task also releases
/// its clone. Reaping explicitly removes that ordering dependency (issue #177).
async fn force_kill_and_reap(child: &mut Child) {
    let _ = child.start_kill();
    let _ = child.wait().await;
}

/// Forward newline-delimited child output to `on_line`, lossily decoding each line so
/// arbitrary (non-UTF8) bytes in agent/tool output degrade to replacement characters
/// instead of terminating the forwarder.
///
/// This replaces a `lines().next_line()` loop whose `Err` arm — raised on invalid UTF-8 —
/// was indistinguishable from EOF, so one bad byte dropped the pipe's read end and armed an
/// EPIPE loop in the runner (issue #177). `read_until` never errors on bad bytes, so the
/// only stops are genuine EOF, a real I/O error, or the callback asking to.
///
/// `on_line` is synchronous by design: a caller that needs async teardown (e.g. dropping the
/// process handle on a fatal IPC error) signals it with `ControlFlow::Break` and performs the
/// teardown after this future resolves. That keeps the seam free of async-closure machinery
/// and directly unit-testable with an in-memory reader.
async fn forward_lines<R, F>(mut reader: R, mut on_line: F)
where
    R: AsyncBufRead + Unpin,
    F: FnMut(String) -> ControlFlow<()>,
{
    let mut buf = Vec::new();
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf).await {
            Ok(0) => break, // EOF: the child closed the stream.
            Ok(_) => {
                if on_line(decode_line(&buf)).is_break() {
                    break;
                }
            }
            // A real read error means the stream is gone; stop rather than spin.
            Err(_) => break,
        }
    }
}

/// Lossily decode one `read_until` chunk into a line, dropping a trailing `\n`/`\r\n`.
/// Pure so the lossy decode and delimiter handling are unit-testable in isolation.
fn decode_line(raw: &[u8]) -> String {
    let mut line = String::from_utf8_lossy(raw).into_owned();
    if line.ends_with('\n') {
        line.pop();
        if line.ends_with('\r') {
            line.pop();
        }
    }
    line
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
        other => Err(RunnerHostError::UnexpectedFirstMessage(format!(
            "{other:?}"
        ))),
    }
}

/// Env keys `extra_env` may not set: every key [`build_env`] can emit. Each has a typed
/// `RunnerConfig` field (or, for `STIGMER_RUNNER_MODE` / `NODE_TLS_REJECT_UNAUTHORIZED`,
/// is derived by the host), so an `extra_env` entry could only shadow or contradict it.
/// The `reserved_env_covers_everything_build_env_emits` test keeps this list and
/// `build_env` from drifting apart.
const RESERVED_ENV_KEYS: &[&str] = &[
    "STIGMER_RUNNER_MODE",
    "STIGMER_BACKEND_ENDPOINT",
    "TEMPORAL_SERVICE_ADDRESS",
    "TEMPORAL_NAMESPACE",
    "STIGMER_TOKEN",
    "CURSOR_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "WORKSPACE_ROOT_DIR",
    "STIGMER_PROXY_ENDPOINT",
    "LOCAL_ARTIFACT_PATH",
    "NODE_TLS_REJECT_UNAUTHORIZED",
];

/// Build the environment the runner subprocess inherits from a [`RunnerConfig`].
///
/// Pure and total (no process, no I/O) so the env mapping is unit-testable. The
/// runner always runs in manager mode here. `TEMPORAL_SERVICE_ADDRESS` is set
/// only when the host provides an address: omitting it is the token-only
/// embedding path, where the runner self-discovers Temporal from the control
/// plane using `STIGMER_TOKEN`.
///
/// Assumes `extra_env` passed [`validate_extra_env`], so appending it cannot
/// duplicate a key emitted above.
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
    if let Some(key) = &config.anthropic_api_key {
        env.push(("ANTHROPIC_API_KEY".to_string(), key.clone()));
    }
    if let Some(key) = &config.openai_api_key {
        env.push(("OPENAI_API_KEY".to_string(), key.clone()));
    }
    if let Some(dir) = &config.workspace_root_dir {
        env.push(("WORKSPACE_ROOT_DIR".to_string(), dir.clone()));
    }
    // Local (OSS) mode: point the runner at the same artifact directory the
    // stigmer-server uses, so a storage-key artifact resolves across the two
    // processes (#285). Omitted lets the runner use its aligned default.
    if let Some(dir) = &config.local_artifact_path {
        env.push(("LOCAL_ARTIFACT_PATH".to_string(), dir.clone()));
    }
    if let Some(proxy) = &config.proxy_endpoint {
        env.push(("STIGMER_PROXY_ENDPOINT".to_string(), proxy.clone()));
        // The runner's Cursor SDK negotiates HTTP/2 over TLS; a self-signed local
        // proxy would otherwise fail the TLS handshake.
        if proxy.starts_with("https://") {
            env.push(("NODE_TLS_REJECT_UNAUTHORIZED".to_string(), "0".to_string()));
        }
    }

    // Sorted so the child env is deterministic (HashMap iteration order is not).
    let mut extra: Vec<(String, String)> = config
        .extra_env
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    extra.sort_by(|(a, _), (b, _)| a.cmp(b));
    env.extend(extra);

    env
}

/// Reject `extra_env` keys the host owns, before anything is spawned.
///
/// Reserved keys are always rejected — even when the current config would not emit them
/// (e.g. `STIGMER_TOKEN` with `stigmer_token: None`) — because each has a typed field
/// that is the one discoverable way to set it. Silently accepting the env spelling would
/// recreate the undocumented side channel this crate exists to replace (issue #250).
fn validate_extra_env(config: &RunnerConfig) -> Result<(), RunnerHostError> {
    for key in config.extra_env.keys() {
        if RESERVED_ENV_KEYS.contains(&key.as_str()) {
            return Err(RunnerHostError::ReservedEnvKey { key: key.clone() });
        }
    }
    Ok(())
}

/// Ensure the runner entry points at a file that exists before we hand it to `node`.
///
/// Unlike the pure seams above, this is intentionally I/O-bound: a relative entry only
/// makes sense relative to the working directory, so the check (and the diagnostic it
/// produces) must consult the filesystem. The error names the working directory the path
/// was resolved against, because that is the one fact a packaged-app embedder cannot see.
fn validate_runner_entry(entry: &str) -> Result<(), RunnerHostError> {
    if std::path::Path::new(entry).is_file() {
        return Ok(());
    }
    let cwd = std::env::current_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "<unknown>".to_string());
    Err(RunnerHostError::RunnerEntryNotFound {
        entry: entry.to_string(),
        cwd,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Drive a future to completion without `#[tokio::test]`/`macros`: the crate already
    /// enables the `rt` feature, and `forward_lines` over an in-memory `&[u8]` needs no IO
    /// or time driver, so a bare current-thread runtime suffices and adds zero dependencies.
    fn block_on<F: std::future::Future>(fut: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("current-thread runtime")
            .block_on(fut)
    }

    #[test]
    fn forward_lines_decodes_invalid_utf8_without_dropping_following_lines() {
        // The 0xFF/0xFE bytes on the middle line are exactly what the old
        // `lines().next_line()` loop reported as `Err` and treated as EOF, silently
        // abandoning the pipe (issue #177). All three lines must survive.
        let input: &[u8] = b"first\n\xff\xfe bad\nthird\n";
        let mut got: Vec<String> = Vec::new();
        block_on(forward_lines(input, |line| {
            got.push(line);
            ControlFlow::Continue(())
        }));

        assert_eq!(
            got.len(),
            3,
            "every line must survive a bad-byte line: {got:?}"
        );
        assert_eq!(got[0], "first");
        assert!(
            got[1].contains("bad"),
            "bad bytes are replaced but the line is kept: {:?}",
            got[1]
        );
        assert_eq!(got[2], "third");
    }

    #[test]
    fn forward_lines_stops_when_callback_breaks() {
        let input: &[u8] = b"one\ntwo\nthree\n";
        let mut got: Vec<String> = Vec::new();
        block_on(forward_lines(input, |line| {
            let stop = line == "two";
            got.push(line);
            if stop {
                ControlFlow::Break(())
            } else {
                ControlFlow::Continue(())
            }
        }));

        assert_eq!(got, vec!["one".to_string(), "two".to_string()]);
    }

    #[test]
    fn forward_lines_emits_final_line_without_trailing_newline() {
        let input: &[u8] = b"only";
        let mut got: Vec<String> = Vec::new();
        block_on(forward_lines(input, |line| {
            got.push(line);
            ControlFlow::Continue(())
        }));

        assert_eq!(got, vec!["only".to_string()]);
    }

    #[test]
    fn decode_line_strips_lf_and_crlf() {
        assert_eq!(decode_line(b"plain\n"), "plain");
        assert_eq!(decode_line(b"windows\r\n"), "windows");
        assert_eq!(decode_line(b"no-newline"), "no-newline");
        assert_eq!(decode_line(b""), "");
    }

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
        let err = negotiate_ready(r#"{"type":"sessionAdded","sessionId":"s","taskQueue":"q"}"#)
            .unwrap_err();
        assert!(matches!(err, RunnerHostError::UnexpectedFirstMessage(_)));
    }

    fn env_value<'a>(env: &'a [(String, String)], key: &str) -> Option<&'a str> {
        env.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
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
            anthropic_api_key: None,
            openai_api_key: None,
            workspace_root_dir: None,
            proxy_endpoint: None,
            local_artifact_path: None,
            extra_env: std::collections::HashMap::new(),
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
    fn build_env_sets_llm_provider_keys_only_when_provided() {
        // BYOK direct mode (issue #250): the typed fields must land as the exact env
        // vars the runner's model client reads, and stay absent otherwise.
        let env = build_env(&minimal_config());
        assert_eq!(env_value(&env, "ANTHROPIC_API_KEY"), None);
        assert_eq!(env_value(&env, "OPENAI_API_KEY"), None);

        let mut config = minimal_config();
        config.anthropic_api_key = Some("sk-ant-test".to_string());
        config.openai_api_key = Some("sk-oai-test".to_string());
        let env = build_env(&config);
        assert_eq!(env_value(&env, "ANTHROPIC_API_KEY"), Some("sk-ant-test"));
        assert_eq!(env_value(&env, "OPENAI_API_KEY"), Some("sk-oai-test"));
    }

    #[test]
    fn build_env_appends_extra_env_sorted_by_key() {
        let mut config = minimal_config();
        config.extra_env = [
            ("LOG_LEVEL".to_string(), "debug".to_string()),
            ("A_CUSTOM_VAR".to_string(), "1".to_string()),
        ]
        .into_iter()
        .collect();

        let env = build_env(&config);

        assert_eq!(env_value(&env, "LOG_LEVEL"), Some("debug"));
        assert_eq!(env_value(&env, "A_CUSTOM_VAR"), Some("1"));
        // Deterministic ordering: extras come after the host-owned block, sorted.
        let tail: Vec<&str> = env.iter().rev().take(2).map(|(k, _)| k.as_str()).collect();
        assert_eq!(tail, vec!["LOG_LEVEL", "A_CUSTOM_VAR"]);
    }

    #[test]
    fn every_reserved_key_is_rejected_in_extra_env() {
        for key in RESERVED_ENV_KEYS {
            let mut config = minimal_config();
            config.extra_env = [(key.to_string(), "x".to_string())].into_iter().collect();

            match validate_extra_env(&config).unwrap_err() {
                RunnerHostError::ReservedEnvKey { key: rejected } => {
                    assert_eq!(&rejected, key)
                }
                other => panic!("expected ReservedEnvKey for {key}, got {other:?}"),
            }
        }
    }

    #[test]
    fn reserved_key_error_points_at_the_typed_field() {
        // The rejection must be actionable: an embedder who reached for the env
        // spelling is told which RunnerConfig field to use instead.
        let mut config = minimal_config();
        config.extra_env = [("ANTHROPIC_API_KEY".to_string(), "sk".to_string())]
            .into_iter()
            .collect();

        let message = validate_extra_env(&config).unwrap_err().to_string();
        assert!(
            message.contains("anthropic_api_key"),
            "error must name the typed field: {message}"
        );
    }

    #[test]
    fn non_reserved_extra_env_passes_validation() {
        // STIGMER_RUNNER_HITL_SECRET is the documented way to pin a HITL fingerprint
        // key across replicas — a deliberate extra_env use case, not a reserved key.
        let mut config = minimal_config();
        config.extra_env = [("STIGMER_RUNNER_HITL_SECRET".to_string(), "s".to_string())]
            .into_iter()
            .collect();
        assert!(validate_extra_env(&config).is_ok());
    }

    #[test]
    fn reserved_env_covers_everything_build_env_emits() {
        // Honesty check (same spirit as the IPC golden fixtures): populate every
        // config field so build_env emits its full vocabulary, then require each
        // emitted key to be reserved. Adding a var to build_env without reserving
        // it fails here — the guard cannot silently rot.
        let config = RunnerConfig {
            node_binary: "node".to_string(),
            runner_entry: "main.js".to_string(),
            temporal_address: Some("temporal.example:7233".to_string()),
            stigmer_endpoint: "https://api.stigmer.ai".to_string(),
            temporal_namespace: Some("ns".to_string()),
            stigmer_token: Some("tok".to_string()),
            cursor_api_key: Some("ck".to_string()),
            anthropic_api_key: Some("ak".to_string()),
            openai_api_key: Some("ok".to_string()),
            workspace_root_dir: Some("/tmp/ws".to_string()),
            // https so the derived NODE_TLS_REJECT_UNAUTHORIZED is emitted too.
            proxy_endpoint: Some("https://proxy.example".to_string()),
            local_artifact_path: Some("/tmp/artifacts".to_string()),
            extra_env: std::collections::HashMap::new(),
        };

        for (key, _) in build_env(&config) {
            assert!(
                RESERVED_ENV_KEYS.contains(&key.as_str()),
                "build_env emits `{key}` but RESERVED_ENV_KEYS does not reserve it; \
                 an extra_env entry could silently shadow it"
            );
        }
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

    #[test]
    fn runner_entry_that_exists_passes() {
        // The crate's own manifest is guaranteed to exist at this absolute path, so it
        // stands in for a correctly-resolved runner entry without touching the filesystem.
        let existing = concat!(env!("CARGO_MANIFEST_DIR"), "/Cargo.toml");
        assert!(validate_runner_entry(existing).is_ok());
    }

    #[test]
    fn missing_runner_entry_is_rejected() {
        // The packaged-app failure mode: a path that does not resolve. The guard must
        // turn it into an actionable error that echoes the offending value, not an
        // opaque downstream failure.
        let missing = concat!(env!("CARGO_MANIFEST_DIR"), "/does-not-exist/runner/main.js");
        match validate_runner_entry(missing).unwrap_err() {
            RunnerHostError::RunnerEntryNotFound { entry, cwd } => {
                assert_eq!(entry, missing);
                assert!(!cwd.is_empty(), "the error must report the resolution cwd");
            }
            other => panic!("expected RunnerEntryNotFound, got {other:?}"),
        }
    }
}
