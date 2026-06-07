//! Embedded runner lifecycle management via stdin/stdout JSON IPC.
//!
//! Spawns a Node.js runner process in manager mode and communicates
//! via newline-delimited JSON on stdin (commands) and stdout (responses).
//! Logs from the runner go to stderr and are forwarded to Tauri's log system.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;
use tauri::State;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

// ─── IPC Protocol Types ─────────────────────────────────────────────────────
// Hand-maintained Rust mirror of the runner's IPC contract. Canonical spec and the rule
// for keeping mirrors in sync: backend/services/runner/docs/ipc-protocol.md.

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum IpcCommand {
    #[serde(rename_all = "camelCase")]
    AddSession { session_id: String },
    #[serde(rename_all = "camelCase")]
    RemoveSession { session_id: String },
    #[serde(rename_all = "camelCase")]
    AddWorkflowExecution { execution_id: String },
    #[serde(rename_all = "camelCase")]
    RemoveWorkflowExecution { execution_id: String },
    UpdateToken { token: Option<String> },
    Shutdown,
}

#[derive(Deserialize, Debug)]
#[serde(tag = "type", rename_all = "camelCase")]
#[allow(dead_code)]
enum IpcResponse {
    #[serde(rename_all = "camelCase")]
    Ready {
        // Optional so an older runner that omits the field still deserializes (treated as
        // version 1). See docs/ipc-protocol.md "Protocol version".
        #[serde(default)]
        protocol_version: Option<u32>,
    },
    #[serde(rename_all = "camelCase")]
    SessionAdded {
        session_id: String,
        task_queue: String,
    },
    #[serde(rename_all = "camelCase")]
    SessionRemoved {
        session_id: String,
    },
    #[serde(rename_all = "camelCase")]
    WorkflowExecutionAdded {
        execution_id: String,
        task_queue: String,
    },
    #[serde(rename_all = "camelCase")]
    WorkflowExecutionRemoved {
        execution_id: String,
    },
    TokenUpdated,
    Error {
        message: String,
        fatal: bool,
    },
    ShutdownComplete,
}

// ─── Runner State ────────────────────────────────────────────────────────────

struct RunnerProcess {
    child: Child,
    stdin: tokio::process::ChildStdin,
    active_sessions: HashSet<String>,
    active_workflow_executions: HashSet<String>,
}

pub struct RunnerState {
    process: Arc<Mutex<Option<RunnerProcess>>>,
}

impl RunnerState {
    pub fn new() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
        }
    }
}

// ─── Runner Configuration ────────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerConfig {
    pub node_binary: String,
    pub runner_entry: String,
    pub temporal_address: String,
    pub stigmer_endpoint: String,
    #[serde(default)]
    pub temporal_namespace: Option<String>,
    #[serde(default)]
    pub stigmer_token: Option<String>,
    #[serde(default)]
    pub cursor_api_key: Option<String>,
    #[serde(default)]
    pub workspace_root_dir: Option<String>,
    #[serde(default)]
    pub proxy_endpoint: Option<String>,
}

// ─── Tauri Commands ──────────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_runner(
    state: State<'_, RunnerState>,
    config: RunnerConfig,
) -> Result<(), String> {
    let mut guard = state.process.lock().await;
    if guard.is_some() {
        return Err("Runner is already running".into());
    }

    let mut cmd = Command::new(&config.node_binary);
    cmd.arg(&config.runner_entry);
    cmd.env("STIGMER_RUNNER_MODE", "manager");
    cmd.env("TEMPORAL_SERVICE_ADDRESS", &config.temporal_address);
    cmd.env("STIGMER_BACKEND_ENDPOINT", &config.stigmer_endpoint);

    if let Some(ns) = &config.temporal_namespace {
        cmd.env("TEMPORAL_NAMESPACE", ns);
    }
    if let Some(token) = &config.stigmer_token {
        cmd.env("STIGMER_TOKEN", token);
    }
    if let Some(key) = &config.cursor_api_key {
        cmd.env("CURSOR_API_KEY", key);
    }
    let workspace_dir = match &config.workspace_root_dir {
        Some(dir) => dir.clone(),
        None => {
            let home = std::env::var("HOME")
                .or_else(|_| std::env::var("USERPROFILE"))
                .map_err(|_| "Cannot determine home directory for workspace".to_string())?;
            let dir = std::path::PathBuf::from(home)
                .join(".stigmer")
                .join("desktop")
                .join("workspace");
            std::fs::create_dir_all(&dir)
                .map_err(|e| format!("Failed to create workspace dir: {e}"))?;
            dir.to_string_lossy().to_string()
        }
    };
    cmd.env("WORKSPACE_ROOT_DIR", &workspace_dir);
    if let Some(proxy) = &config.proxy_endpoint {
        cmd.env("STIGMER_PROXY_ENDPOINT", proxy);
        if proxy.starts_with("https://") {
            cmd.env("NODE_TLS_REJECT_UNAUTHORIZED", "0");
        }
    }

    cmd.stdin(std::process::Stdio::piped());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("Failed to spawn runner: {e}"))?;

    let stdin = child.stdin.take().ok_or("Failed to capture runner stdin")?;
    let stdout = child.stdout.take().ok_or("Failed to capture runner stdout")?;

    // Forward stderr to Tauri logs in a background task
    if let Some(stderr) = child.stderr.take() {
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                eprintln!("[runner-stderr] {line}");
            }
        });
    }

    // Wait for the "ready" message
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .await
        .map_err(|e| format!("Failed to read ready message: {e}"))?;

    let response: IpcResponse =
        serde_json::from_str(line.trim()).map_err(|e| format!("Invalid ready message: {e}"))?;

    match response {
        IpcResponse::Ready { protocol_version } => {
            eprintln!("[runner-ipc] ready (protocolVersion={protocol_version:?})");
        }
        IpcResponse::Error { message, .. } => {
            let _ = child.kill().await;
            return Err(format!("Runner failed to start: {message}"));
        }
        other => {
            let _ = child.kill().await;
            return Err(format!("Unexpected first message from runner: {other:?}"));
        }
    }

    // Spawn background task to read stdout responses
    let process_arc = state.process.clone();
    tokio::spawn(async move {
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Ok(resp) = serde_json::from_str::<IpcResponse>(&line) {
                match resp {
                    IpcResponse::Error { message, fatal } => {
                        eprintln!("[runner-ipc] Error: {message} (fatal={fatal})");
                        if fatal {
                            let mut guard = process_arc.lock().await;
                            *guard = None;
                            break;
                        }
                    }
                    _ => {
                        // Other responses are handled inline by the command that sent them.
                        // For the background reader, we just log them.
                        eprintln!("[runner-ipc] Response: {line}");
                    }
                }
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

#[tauri::command]
pub async fn stop_runner(state: State<'_, RunnerState>) -> Result<(), String> {
    let mut guard = state.process.lock().await;
    let proc = guard.as_mut().ok_or("Runner is not running")?;

    let cmd = serde_json::to_string(&IpcCommand::Shutdown).unwrap();
    proc.stdin
        .write_all(format!("{cmd}\n").as_bytes())
        .await
        .map_err(|e| format!("Failed to send shutdown: {e}"))?;
    proc.stdin.flush().await.ok();

    // Wait for process to exit (with timeout)
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        proc.child.wait(),
    )
    .await;

    *guard = None;
    Ok(())
}

#[tauri::command]
pub async fn add_session(
    state: State<'_, RunnerState>,
    session_id: String,
) -> Result<String, String> {
    let mut guard = state.process.lock().await;
    let proc = guard.as_mut().ok_or("Runner is not running")?;

    if proc.active_sessions.contains(&session_id) {
        return Ok(format!("session:{session_id}"));
    }

    let cmd = serde_json::to_string(&IpcCommand::AddSession {
        session_id: session_id.clone(),
    })
    .unwrap();

    proc.stdin
        .write_all(format!("{cmd}\n").as_bytes())
        .await
        .map_err(|e| format!("Failed to send addSession: {e}"))?;
    proc.stdin.flush().await.ok();

    proc.active_sessions.insert(session_id.clone());
    Ok(format!("session:{session_id}"))
}

#[tauri::command]
pub async fn remove_session(
    state: State<'_, RunnerState>,
    session_id: String,
) -> Result<(), String> {
    let mut guard = state.process.lock().await;
    let proc = guard.as_mut().ok_or("Runner is not running")?;

    if !proc.active_sessions.contains(&session_id) {
        return Ok(());
    }

    let cmd = serde_json::to_string(&IpcCommand::RemoveSession {
        session_id: session_id.clone(),
    })
    .unwrap();

    proc.stdin
        .write_all(format!("{cmd}\n").as_bytes())
        .await
        .map_err(|e| format!("Failed to send removeSession: {e}"))?;
    proc.stdin.flush().await.ok();

    proc.active_sessions.remove(&session_id);
    Ok(())
}

#[tauri::command]
pub async fn add_workflow_execution(
    state: State<'_, RunnerState>,
    execution_id: String,
) -> Result<String, String> {
    let mut guard = state.process.lock().await;
    let proc = guard.as_mut().ok_or("Runner is not running")?;

    if proc.active_workflow_executions.contains(&execution_id) {
        return Ok(format!("wfexec:{execution_id}"));
    }

    let cmd = serde_json::to_string(&IpcCommand::AddWorkflowExecution {
        execution_id: execution_id.clone(),
    })
    .unwrap();

    proc.stdin
        .write_all(format!("{cmd}\n").as_bytes())
        .await
        .map_err(|e| format!("Failed to send addWorkflowExecution: {e}"))?;
    proc.stdin.flush().await.ok();

    proc.active_workflow_executions.insert(execution_id.clone());
    Ok(format!("wfexec:{execution_id}"))
}

#[tauri::command]
pub async fn remove_workflow_execution(
    state: State<'_, RunnerState>,
    execution_id: String,
) -> Result<(), String> {
    let mut guard = state.process.lock().await;
    let proc = guard.as_mut().ok_or("Runner is not running")?;

    if !proc.active_workflow_executions.contains(&execution_id) {
        return Ok(());
    }

    let cmd = serde_json::to_string(&IpcCommand::RemoveWorkflowExecution {
        execution_id: execution_id.clone(),
    })
    .unwrap();

    proc.stdin
        .write_all(format!("{cmd}\n").as_bytes())
        .await
        .map_err(|e| format!("Failed to send removeWorkflowExecution: {e}"))?;
    proc.stdin.flush().await.ok();

    proc.active_workflow_executions.remove(&execution_id);
    Ok(())
}

#[tauri::command]
pub async fn update_runner_token(
    state: State<'_, RunnerState>,
    token: Option<String>,
) -> Result<(), String> {
    let mut guard = state.process.lock().await;
    let proc = guard.as_mut().ok_or("Runner is not running")?;

    let cmd = serde_json::to_string(&IpcCommand::UpdateToken { token }).unwrap();
    proc.stdin
        .write_all(format!("{cmd}\n").as_bytes())
        .await
        .map_err(|e| format!("Failed to send updateToken: {e}"))?;
    proc.stdin.flush().await.ok();

    Ok(())
}

#[tauri::command]
pub async fn runner_status(
    state: State<'_, RunnerState>,
) -> Result<RunnerStatusResponse, String> {
    let guard = state.process.lock().await;
    match guard.as_ref() {
        Some(proc) => Ok(RunnerStatusResponse {
            running: true,
            active_sessions: proc.active_sessions.iter().cloned().collect(),
            active_workflow_executions: proc.active_workflow_executions.iter().cloned().collect(),
        }),
        None => Ok(RunnerStatusResponse {
            running: false,
            active_sessions: vec![],
            active_workflow_executions: vec![],
        }),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerStatusResponse {
    pub running: bool,
    pub active_sessions: Vec<String>,
    pub active_workflow_executions: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    // Backward-compatibility contract: the host must parse `ready` whether or not the runner
    // sends protocolVersion. An older runner omits it. See docs/ipc-protocol.md.
    #[test]
    fn ready_parses_with_protocol_version() {
        let resp: IpcResponse =
            serde_json::from_str(r#"{"type":"ready","protocolVersion":1}"#).unwrap();
        match resp {
            IpcResponse::Ready { protocol_version } => {
                assert_eq!(protocol_version, Some(1), "should read the advertised version");
            }
            other => panic!("expected Ready, got {other:?}"),
        }
    }

    #[test]
    fn ready_parses_without_protocol_version() {
        let resp: IpcResponse = serde_json::from_str(r#"{"type":"ready"}"#).unwrap();
        match resp {
            IpcResponse::Ready { protocol_version } => {
                assert_eq!(protocol_version, None, "absent field must default to None");
            }
            other => panic!("expected Ready, got {other:?}"),
        }
    }
}
