use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::PathBuf;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::Mutex;

const LOG_BUFFER_CAPACITY: usize = 2000;

// ---------------------------------------------------------------------------
// On-disk runner state (matches Go CLI's ~/.stigmer/runners/<name>.json)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunnerStateFile {
    pub runner_id: String,
    pub slug: String,
    pub org: String,
    pub backend_endpoint: String,
    pub pid: i64,
    pub task_queue: String,
    pub started_at: String,
    #[serde(default)]
    pub managed_by_daemon: bool,
    #[serde(default)]
    pub log_file: Option<String>,
    #[serde(default)]
    pub machine_id: Option<String>,
    #[serde(default)]
    pub socket_path: Option<String>,
    #[serde(default)]
    pub runtime: Option<String>,
}

// ---------------------------------------------------------------------------
// Types returned to the frontend
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct LocalRunnerInfo {
    pub name: String,
    pub runner_id: String,
    pub slug: String,
    pub org: String,
    pub backend_endpoint: String,
    pub pid: i64,
    pub task_queue: String,
    pub started_at: String,
    pub managed_by_daemon: bool,
    pub managed_by_desktop: bool,
    pub log_file: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RunnerLogEntry {
    pub name: String,
    pub line: String,
    pub stream: String,
}

// ---------------------------------------------------------------------------
// Structured JSON output from `stigmer up --json` (CLI → sidecar contract)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
enum CliEnsureOutput {
    Success(CliEnsureResult),
    Error(CliEnsureError),
}

#[derive(Debug, Clone, Deserialize)]
#[allow(dead_code)]
struct CliEnsureResult {
    ok: bool,
    action: String,
    runner_id: String,
    name: String,
    org: String,
    pid: Option<i64>,
    runtime: String,
    backend_endpoint: String,
    task_queue: String,
    started_at: String,
    log_file: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct CliEnsureError {
    ok: bool,
    error: String,
    #[allow(dead_code)]
    hint: Option<String>,
}

// ---------------------------------------------------------------------------
// Control socket client — queries the T04 Unix socket for live runner state
// ---------------------------------------------------------------------------

/// Live status returned by `query_runner_socket`. The `source` field
/// indicates how the data was obtained so the frontend can show
/// appropriate confidence indicators.
#[derive(Debug, Clone, Serialize)]
pub struct LocalRunnerStatus {
    pub source: String,
    pub running: bool,
    pub name: Option<String>,
    pub runner_id: Option<String>,
    pub machine_id: Option<String>,
    pub org: Option<String>,
    pub backend_endpoint: Option<String>,
    pub pid: Option<i64>,
    pub started_at: Option<String>,
    pub uptime: Option<String>,
    pub runtime: Option<String>,
    pub version: Option<String>,
}

/// JSON shape returned by the Go control socket's `GET /status`.
#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct SocketStatusResponse {
    ok: bool,
    runner_id: Option<String>,
    name: Option<String>,
    machine_id: Option<String>,
    org: Option<String>,
    backend_endpoint: Option<String>,
    task_queue: Option<String>,
    pid: Option<i64>,
    started_at: Option<String>,
    uptime: Option<String>,
    runtime: Option<String>,
    version: Option<String>,
}

/// JSON shape returned by the Go control socket's `POST /stop`.
#[derive(Debug, Deserialize)]
struct SocketStopResponse {
    ok: bool,
    message: Option<String>,
}

/// Default socket path used by the CLI runner (T04).
fn default_socket_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_default();
    home.join(".stigmer").join("run").join("runner.sock")
}

/// Discovers the socket path by checking: (1) the well-known default,
/// (2) `socket_path` entries in on-disk runner state files.
fn discover_socket_path() -> Option<PathBuf> {
    let default = default_socket_path();
    if default.exists() {
        return Some(default);
    }

    let dir = runners_dir().ok()?;
    if !dir.exists() {
        return None;
    }

    for entry in fs::read_dir(&dir).ok()?.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "json") {
            if let Ok(data) = fs::read_to_string(&path) {
                if let Ok(state) = serde_json::from_str::<RunnerStateFile>(&data) {
                    if let Some(ref sp) = state.socket_path {
                        let sp = PathBuf::from(sp);
                        if sp.exists() {
                            return Some(sp);
                        }
                    }
                }
            }
        }
    }
    None
}

const SOCKET_TIMEOUT_MS: u64 = 2000;

/// Sends a raw HTTP/1.1 request over a Unix socket and returns the
/// response body (everything after the `\r\n\r\n` header terminator).
async fn unix_http_request(socket_path: &std::path::Path, request: &[u8]) -> Result<String, String> {
    let stream = tokio::time::timeout(
        tokio::time::Duration::from_millis(SOCKET_TIMEOUT_MS),
        tokio::net::UnixStream::connect(socket_path),
    )
    .await
    .map_err(|_| "socket connect timed out".to_string())?
    .map_err(|e| format!("socket connect failed: {e}"))?;

    let (mut reader, mut writer) = stream.into_split();

    writer
        .write_all(request)
        .await
        .map_err(|e| format!("socket write failed: {e}"))?;
    writer
        .shutdown()
        .await
        .map_err(|e| format!("socket shutdown failed: {e}"))?;

    let mut buf = Vec::with_capacity(4096);
    tokio::time::timeout(
        tokio::time::Duration::from_millis(SOCKET_TIMEOUT_MS),
        reader.read_to_end(&mut buf),
    )
    .await
    .map_err(|_| "socket read timed out".to_string())?
    .map_err(|e| format!("socket read failed: {e}"))?;

    let raw = String::from_utf8_lossy(&buf);

    let body_start = raw
        .find("\r\n\r\n")
        .map(|i| i + 4)
        .unwrap_or(0);
    Ok(raw[body_start..].to_string())
}

/// Builds a `LocalRunnerStatus` from on-disk state files as a fallback
/// when the socket is unavailable.
fn status_from_disk() -> LocalRunnerStatus {
    let dir = match runners_dir() {
        Ok(d) => d,
        Err(_) => return unavailable_status(),
    };
    if !dir.exists() {
        return unavailable_status();
    }

    for entry in fs::read_dir(&dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "json") {
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_string();

            if let Ok(data) = fs::read_to_string(&path) {
                if let Ok(state) = serde_json::from_str::<RunnerStateFile>(&data) {
                    if is_process_alive(state.pid) {
                        return LocalRunnerStatus {
                            source: "disk".into(),
                            running: true,
                            name: Some(name),
                            runner_id: Some(state.runner_id),
                            machine_id: state.machine_id,
                            org: Some(state.org),
                            backend_endpoint: Some(state.backend_endpoint),
                            pid: Some(state.pid),
                            started_at: Some(state.started_at),
                            uptime: None,
                            runtime: state.runtime,
                            version: None,
                        };
                    }
                }
            }
        }
    }
    unavailable_status()
}

fn unavailable_status() -> LocalRunnerStatus {
    LocalRunnerStatus {
        source: "unavailable".into(),
        running: false,
        name: None,
        runner_id: None,
        machine_id: None,
        org: None,
        backend_endpoint: None,
        pid: None,
        started_at: None,
        uptime: None,
        runtime: None,
        version: None,
    }
}

/// Attempt to parse the combined early stdout lines as the CLI's JSON
/// ensure result. Returns None if the output is not valid JSON or does
/// not match the expected shape.
fn try_parse_ensure_output(stdout_lines: &[String]) -> Option<CliEnsureOutput> {
    let combined = stdout_lines.join("");
    let trimmed = combined.trim();
    if trimmed.is_empty() || !trimmed.starts_with('{') {
        return None;
    }
    serde_json::from_str(trimmed).ok()
}

// ---------------------------------------------------------------------------
// Events emitted to the frontend via Tauri's event system
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
struct RunnerStartedEvent {
    name: String,
    pid: u32,
}

#[derive(Debug, Clone, Serialize)]
struct RunnerStoppedEvent {
    name: String,
    exit_code: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
struct RunnerErrorEvent {
    name: String,
    message: String,
}

// ---------------------------------------------------------------------------
// Process manager state
// ---------------------------------------------------------------------------

struct ManagedRunner {
    _child: CommandChild,
    pid: u32,
    _started_at: Instant,
    log_buffer: VecDeque<String>,
}

pub struct ProcessManager {
    runners: Mutex<HashMap<String, ManagedRunner>>,
}

impl ProcessManager {
    pub fn new() -> Self {
        Self {
            runners: Mutex::new(HashMap::new()),
        }
    }

    /// Returns the names of all desktop-managed runners, or None if the lock is contended.
    pub(crate) fn runner_names(&self) -> Option<Vec<String>> {
        let guard = self.runners.try_lock().ok()?;
        Some(guard.keys().cloned().collect())
    }

    /// Sends SIGTERM to every managed runner and waits briefly for exit.
    /// Called during application shutdown to prevent zombie processes.
    pub fn shutdown_all_sync(&self) {
        let runners = self.runners.blocking_lock();
        for (name, runner) in runners.iter() {
            log::info!("Shutting down managed runner '{}' (PID {})", name, runner.pid);
            #[cfg(unix)]
            unsafe {
                libc::kill(runner.pid as i32, libc::SIGTERM);
            }
        }

        if !runners.is_empty() {
            std::thread::sleep(std::time::Duration::from_secs(3));

            for (name, runner) in runners.iter() {
                if is_process_alive(runner.pid as i64) {
                    log::warn!(
                        "Runner '{}' (PID {}) did not exit in time, sending SIGKILL",
                        name,
                        runner.pid
                    );
                    #[cfg(unix)]
                    unsafe {
                        libc::kill(runner.pid as i32, libc::SIGKILL);
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn runners_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("could not resolve home directory")?;
    let dir = home.join(".stigmer").join("runners");
    Ok(dir)
}

fn is_process_alive(pid: i64) -> bool {
    if pid <= 0 {
        return false;
    }
    #[cfg(unix)]
    {
        unsafe { libc::kill(pid as i32, 0) == 0 }
    }
    #[cfg(not(unix))]
    {
        // On non-Unix, assume alive if PID > 0 — the CLI handles reaping.
        true
    }
}

fn read_all_runner_states() -> Result<Vec<LocalRunnerInfo>, String> {
    let dir = runners_dir()?;
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&dir).map_err(|e| format!("failed to read runners dir: {e}"))?;
    let mut runners = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "json") {
            let name = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_string();

            let data = match fs::read_to_string(&path) {
                Ok(d) => d,
                Err(_) => continue,
            };
            let state: RunnerStateFile = match serde_json::from_str(&data) {
                Ok(s) => s,
                Err(_) => continue,
            };

            if !is_process_alive(state.pid) {
                let _ = fs::remove_file(&path);
                continue;
            }

            runners.push(LocalRunnerInfo {
                name,
                runner_id: state.runner_id,
                slug: state.slug,
                org: state.org,
                backend_endpoint: state.backend_endpoint,
                pid: state.pid,
                task_queue: state.task_queue,
                started_at: state.started_at,
                managed_by_daemon: state.managed_by_daemon,
                managed_by_desktop: false,
                log_file: state.log_file,
            });
        }
    }

    Ok(runners)
}

// ---------------------------------------------------------------------------
// Shared runner operations
// ---------------------------------------------------------------------------

/// Stops all desktop-managed runners and emits lifecycle events.
/// Used by both the `stop_all_runners` Tauri command and the tray "Stop All Runners" action.
pub(crate) async fn stop_all_managed(app: &AppHandle) {
    let mgr = app.state::<ProcessManager>();
    let mut runners = mgr.runners.lock().await;
    let names: Vec<String> = runners.keys().cloned().collect();

    for name in names {
        if let Some(runner) = runners.remove(&name) {
            #[cfg(unix)]
            unsafe {
                libc::kill(runner.pid as i32, libc::SIGTERM);
            }
            #[cfg(not(unix))]
            drop(runner);

            let _ = app.emit(
                "runner:stopped",
                RunnerStoppedEvent {
                    name,
                    exit_code: None,
                },
            );
        }
    }

    drop(runners);
    crate::tray::refresh_tray_state(app);
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Grace period to wait for the CLI to either stabilize or fail before
/// returning success. Most startup failures (auth errors, connection
/// refused) surface within a few seconds.
const STARTUP_GRACE_MS: u64 = 8000;

#[tauri::command]
pub async fn start_runner(
    app: AppHandle,
    state: State<'_, ProcessManager>,
    name: Option<String>,
    endpoint: Option<String>,
    token: Option<String>,
    org: Option<String>,
) -> Result<String, String> {
    let runner_name = name.clone().unwrap_or_else(|| {
        hostname::get()
            .ok()
            .and_then(|h| h.into_string().ok())
            .unwrap_or_else(|| "desktop-runner".to_string())
    });

    {
        let runners = state.runners.lock().await;
        if runners.contains_key(&runner_name) {
            return Ok(runner_name);
        }
    }

    let mut args: Vec<String> = vec!["up".into(), "runner".into(), "--standalone".into(), "--json".into()];
    if let Some(ref n) = name {
        args.push("--name".into());
        args.push(n.clone());
    }
    if let Some(ref ep) = endpoint {
        args.push("--endpoint".into());
        args.push(ep.clone());
    }
    if let Some(ref t) = token {
        args.push("--token".into());
        args.push(t.clone());
    }
    if let Some(ref o) = org {
        args.push("--org".into());
        args.push(o.clone());
    }

    let sidecar = app
        .shell()
        .sidecar("stigmer-cli")
        .map_err(|e| format!("failed to create sidecar command: {e}"))?
        .args(&args);

    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|e| format!("failed to spawn sidecar: {e}"))?;

    let pid = child.pid();

    // Wait for the CLI to either fail fast or survive the grace period.
    // During this window we collect both stdout and stderr so that:
    //   - startup errors (auth failures, connection refused) are returned synchronously
    //   - early output is not lost and can be replayed into the log buffer
    let grace_deadline = tokio::time::Instant::now()
        + tokio::time::Duration::from_millis(STARTUP_GRACE_MS);
    let mut early_output: Vec<String> = Vec::new();
    let mut early_stdout: Vec<String> = Vec::new();
    let mut early_stderr: Vec<String> = Vec::new();
    let mut early_exit: Option<Option<i32>> = None;

    loop {
        let remaining = grace_deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }

        tokio::select! {
            event = rx.recv() => {
                use tauri_plugin_shell::process::CommandEvent;
                match event {
                    Some(CommandEvent::Stderr(bytes)) => {
                        let line = String::from_utf8_lossy(&bytes).to_string();
                        early_stderr.push(line.clone());
                        early_output.push(line);
                    }
                    Some(CommandEvent::Stdout(bytes)) => {
                        let line = String::from_utf8_lossy(&bytes).to_string();
                        early_stdout.push(line.clone());
                        early_output.push(line);
                    }
                    Some(CommandEvent::Terminated(payload)) => {
                        early_exit = Some(payload.code);
                        break;
                    }
                    Some(CommandEvent::Error(msg)) => {
                        early_stderr.push(msg.clone());
                        early_output.push(msg);
                    }
                    None => {
                        early_exit = Some(None);
                        break;
                    }
                    _ => {}
                }
            }
            _ = tokio::time::sleep_until(grace_deadline) => {
                break;
            }
        }
    }

    if let Some(code) = early_exit {
        let exit_code = code.unwrap_or(-1);

        // Try to parse structured JSON from stdout (available when --json is active).
        if let Some(parsed) = try_parse_ensure_output(&early_stdout) {
            match parsed {
                CliEnsureOutput::Success(result) if result.ok => {
                    return Ok(result.name);
                }
                CliEnsureOutput::Error(err) if !err.ok => {
                    return Err(err.error);
                }
                _ => {}
            }
        }

        if exit_code != 0 {
            let detail = if early_stderr.is_empty() {
                format!("CLI exited with code {exit_code}")
            } else {
                early_stderr.join("\n").trim().to_string()
            };
            return Err(detail);
        }
        // CLI exited 0 during grace period — adoption case (runner already active).
        // The child process has already terminated so we must NOT register it in
        // ProcessManager. The runner is tracked via on-disk state files and will
        // appear in list_local_runners.
        return Ok(runner_name);
    }

    // CLI survived the grace period — register it as managed.
    {
        let mut runners = state.runners.lock().await;
        runners.insert(
            runner_name.clone(),
            ManagedRunner {
                _child: child,
                pid,
                _started_at: Instant::now(),
                log_buffer: VecDeque::with_capacity(LOG_BUFFER_CAPACITY),
            },
        );
    }

    let _ = app.emit("runner:started", RunnerStartedEvent {
        name: runner_name.clone(),
        pid,
    });
    crate::tray::refresh_tray_state(&app);

    let event_app = app.clone();
    let event_name = runner_name.clone();

    // Replay all output captured during the grace period (stdout + stderr)
    // into the log buffer so it is available to `get_runner_logs`.
    {
        let mgr = app.state::<ProcessManager>();
        let mut runners = mgr.runners.lock().await;
        if let Some(runner) = runners.get_mut(&runner_name) {
            for line in &early_output {
                if runner.log_buffer.len() >= LOG_BUFFER_CAPACITY {
                    runner.log_buffer.pop_front();
                }
                runner.log_buffer.push_back(line.clone());
            }
        }
    }

    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).to_string();
                    {
                        let mgr = event_app.state::<ProcessManager>();
                        let mut runners = mgr.runners.lock().await;
                        if let Some(runner) = runners.get_mut(&event_name) {
                            if runner.log_buffer.len() >= LOG_BUFFER_CAPACITY {
                                runner.log_buffer.pop_front();
                            }
                            runner.log_buffer.push_back(line.clone());
                        }
                    }
                    let _ = event_app.emit(
                        "runner:log",
                        RunnerLogEntry {
                            name: event_name.clone(),
                            line,
                            stream: "stdout".into(),
                        },
                    );
                }
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).to_string();
                    {
                        let mgr = event_app.state::<ProcessManager>();
                        let mut runners = mgr.runners.lock().await;
                        if let Some(runner) = runners.get_mut(&event_name) {
                            if runner.log_buffer.len() >= LOG_BUFFER_CAPACITY {
                                runner.log_buffer.pop_front();
                            }
                            runner.log_buffer.push_back(line.clone());
                        }
                    }
                    let _ = event_app.emit(
                        "runner:log",
                        RunnerLogEntry {
                            name: event_name.clone(),
                            line,
                            stream: "stderr".into(),
                        },
                    );
                }
                CommandEvent::Terminated(payload) => {
                    {
                        let mgr = event_app.state::<ProcessManager>();
                        let mut runners = mgr.runners.lock().await;
                        runners.remove(&event_name);
                    }
                    let _ = event_app.emit(
                        "runner:stopped",
                        RunnerStoppedEvent {
                            name: event_name.clone(),
                            exit_code: payload.code,
                        },
                    );
                    crate::tray::refresh_tray_state(&event_app);
                    break;
                }
                CommandEvent::Error(msg) => {
                    let _ = event_app.emit(
                        "runner:error",
                        RunnerErrorEvent {
                            name: event_name.clone(),
                            message: msg,
                        },
                    );
                }
                _ => {}
            }
        }
    });

    Ok(runner_name)
}

#[tauri::command]
pub async fn stop_runner(
    app: AppHandle,
    state: State<'_, ProcessManager>,
    runner_name: String,
    token: Option<String>,
    endpoint: Option<String>,
    org: Option<String>,
) -> Result<(), String> {
    let was_managed = {
        let mut runners = state.runners.lock().await;
        if let Some(runner) = runners.remove(&runner_name) {
            #[cfg(unix)]
            unsafe {
                libc::kill(runner.pid as i32, libc::SIGTERM);
            }
            #[cfg(not(unix))]
            drop(runner);
            true
        } else {
            false
        }
    };

    if was_managed {
        let _ = app.emit(
            "runner:stopped",
            RunnerStoppedEvent {
                name: runner_name,
                exit_code: None,
            },
        );
        crate::tray::refresh_tray_state(&app);
        return Ok(());
    }

    // Not managed by this desktop instance — try stopping via the CLI.
    let mut args: Vec<String> = vec![
        "down".into(),
        "runner".into(),
        "--standalone".into(),
        "--name".into(),
        runner_name.clone(),
    ];
    if let Some(ref t) = token {
        args.push("--token".into());
        args.push(t.clone());
    }
    if let Some(ref ep) = endpoint {
        args.push("--endpoint".into());
        args.push(ep.clone());
    }
    if let Some(ref o) = org {
        args.push("--org".into());
        args.push(o.clone());
    }

    let sidecar = app
        .shell()
        .sidecar("stigmer-cli")
        .map_err(|e| format!("failed to create sidecar command: {e}"))?
        .args(&args);

    let output = sidecar
        .output()
        .await
        .map_err(|e| format!("failed to run stop command: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("failed to stop runner '{runner_name}': {stderr}"));
    }

    Ok(())
}

#[tauri::command]
pub async fn stop_all_runners(app: AppHandle) -> Result<(), String> {
    stop_all_managed(&app).await;
    Ok(())
}

#[tauri::command]
pub async fn list_local_runners(
    state: State<'_, ProcessManager>,
) -> Result<Vec<LocalRunnerInfo>, String> {
    let mut runners = read_all_runner_states()?;
    let managed = state.runners.lock().await;

    for runner in &mut runners {
        if managed.contains_key(&runner.name) {
            runner.managed_by_desktop = true;
        }
    }

    Ok(runners)
}

#[tauri::command]
pub async fn get_runner_logs(
    state: State<'_, ProcessManager>,
    runner_name: String,
    tail: Option<usize>,
) -> Result<Vec<String>, String> {
    let runners = state.runners.lock().await;
    let runner = runners
        .get(&runner_name)
        .ok_or_else(|| format!("no active log buffer for runner '{runner_name}'"))?;

    let limit = tail.unwrap_or(200);
    let start = runner.log_buffer.len().saturating_sub(limit);
    let lines: Vec<String> = runner.log_buffer.iter().skip(start).cloned().collect();

    Ok(lines)
}

/// Returns true if a log file exists on disk for the given runner name.
/// Used by the frontend to determine whether "View Logs" should be shown
/// for stopped runners whose state file has already been cleaned up.
#[tauri::command]
pub async fn check_runner_log_exists(runner_name: String) -> Result<bool, String> {
    let dir = runners_dir()?;
    let log_path = dir.join(format!("{runner_name}.log"));
    Ok(log_path.exists())
}

/// Reads the last `tail` lines from a runner's on-disk log file. This
/// works for any local runner (CLI-started, daemon-managed, or desktop-
/// managed) as long as the CLI wrote a log file.
#[tauri::command]
pub async fn tail_runner_log_file(
    runner_name: String,
    tail: Option<usize>,
) -> Result<Vec<String>, String> {
    let dir = runners_dir()?;
    let log_path = dir.join(format!("{runner_name}.log"));

    if !log_path.exists() {
        return Err(format!("no log file for runner '{runner_name}'"));
    }

    let content = fs::read_to_string(&log_path)
        .map_err(|e| format!("failed to read log file: {e}"))?;

    let limit = tail.unwrap_or(2000);
    let all_lines: Vec<&str> = content.lines().collect();
    let start = all_lines.len().saturating_sub(limit);
    let lines: Vec<String> = all_lines[start..].iter().map(|s| s.to_string()).collect();

    Ok(lines)
}

/// Starts watching a runner's log file for new content and emits
/// `runner:log-file` events as new lines are appended. Returns
/// immediately; the watcher runs in a background task until the
/// runner stops or the watch is superseded.
#[tauri::command]
pub async fn watch_runner_log_file(
    app: AppHandle,
    runner_name: String,
) -> Result<(), String> {
    let dir = runners_dir()?;
    let log_path = dir.join(format!("{runner_name}.log"));

    if !log_path.exists() {
        return Err(format!("no log file for runner '{runner_name}'"));
    }

    let metadata = fs::metadata(&log_path)
        .map_err(|e| format!("failed to stat log file: {e}"))?;
    let initial_len = metadata.len();

    let event_name = runner_name.clone();
    let path = log_path.clone();

    tauri::async_runtime::spawn(async move {
        let mut last_offset = initial_len;
        let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(500));

        loop {
            interval.tick().await;

            // Check if the runner is still alive by verifying the state file exists.
            let state_path = path.with_extension("json");
            if !state_path.exists() {
                break;
            }

            let current_len = match fs::metadata(&path) {
                Ok(m) => m.len(),
                Err(_) => break,
            };

            if current_len <= last_offset {
                if current_len < last_offset {
                    // File was truncated (new session); reset.
                    last_offset = 0;
                }
                continue;
            }

            let content = match fs::read_to_string(&path) {
                Ok(c) => c,
                Err(_) => continue,
            };

            // Find lines that start after the last known offset.
            let new_content = if (last_offset as usize) < content.len() {
                &content[last_offset as usize..]
            } else {
                ""
            };

            for line in new_content.lines() {
                if line.is_empty() {
                    continue;
                }
                let _ = app.emit(
                    "runner:log-file",
                    RunnerLogEntry {
                        name: event_name.clone(),
                        line: line.to_string(),
                        stream: "file".into(),
                    },
                );
            }

            last_offset = current_len;
        }
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// Control socket Tauri commands
// ---------------------------------------------------------------------------

/// Queries the local runner's control socket for live status.
/// Falls back to on-disk state files when the socket is unavailable.
#[tauri::command]
pub async fn query_runner_socket() -> Result<LocalRunnerStatus, String> {
    let socket_path = match discover_socket_path() {
        Some(p) => p,
        None => return Ok(status_from_disk()),
    };

    let request = b"GET /status HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n";

    match unix_http_request(&socket_path, request).await {
        Ok(body) => {
            match serde_json::from_str::<SocketStatusResponse>(&body) {
                Ok(resp) if resp.ok => Ok(LocalRunnerStatus {
                    source: "socket".into(),
                    running: true,
                    name: resp.name,
                    runner_id: resp.runner_id,
                    machine_id: resp.machine_id,
                    org: resp.org,
                    backend_endpoint: resp.backend_endpoint,
                    pid: resp.pid,
                    started_at: resp.started_at,
                    uptime: resp.uptime,
                    runtime: resp.runtime,
                    version: resp.version,
                }),
                Ok(_) | Err(_) => Ok(status_from_disk()),
            }
        }
        Err(_) => Ok(status_from_disk()),
    }
}

/// Sends a graceful stop request to the runner via its control socket.
/// Falls back to the existing SIGTERM-based stop path when the socket
/// is unavailable.
#[tauri::command]
pub async fn stop_runner_via_socket() -> Result<(), String> {
    let socket_path = match discover_socket_path() {
        Some(p) => p,
        None => return Err("no runner socket found".into()),
    };

    let request = b"POST /stop HTTP/1.1\r\nHost: localhost\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";

    let body = unix_http_request(&socket_path, request).await?;

    match serde_json::from_str::<SocketStopResponse>(&body) {
        Ok(resp) if resp.ok => Ok(()),
        Ok(resp) => Err(format!(
            "stop not accepted: {}",
            resp.message.unwrap_or_default()
        )),
        Err(e) => Err(format!("failed to parse stop response: {e}")),
    }
}
