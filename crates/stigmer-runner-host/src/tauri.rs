//! Tauri binding for [`RunnerHost`] — the desktop's `#[tauri::command]` surface.
//!
//! This module owns every JS-facing wire shape so the core stays free of JS-isms:
//! the camelCase config input, the camelCase status response, the synthetic
//! `session:`/`wfexec:` handles, the `RunnerHostError -> String` flattening, and the
//! desktop's workspace HOME-fallback (host policy, not driver behavior).

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::config::RunnerConfig;
use crate::host::{RunnerHost, RunnerStatus};

/// Tauri-managed state wrapping a single [`RunnerHost`].
pub struct RunnerState {
    host: RunnerHost,
}

impl RunnerState {
    pub fn new() -> Self {
        Self {
            host: RunnerHost::new(),
        }
    }
}

impl Default for RunnerState {
    fn default() -> Self {
        Self::new()
    }
}

/// camelCase config as the JS frontend sends it. Mapped onto the core snake_case
/// [`RunnerConfig`] so the core never carries the JS shape.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerConfigInput {
    pub node_binary: String,
    pub runner_entry: String,
    /// Optional: omit for token-only embedding, where the runner self-discovers
    /// the Temporal address from the control plane using `stigmerToken`.
    #[serde(default)]
    pub temporal_address: Option<String>,
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

impl RunnerConfigInput {
    /// Resolve into the core config, applying the desktop's workspace HOME-fallback when
    /// the frontend does not supply a directory.
    fn into_core(self) -> Result<RunnerConfig, String> {
        let workspace_root_dir = match self.workspace_root_dir {
            Some(dir) => dir,
            None => default_workspace_dir()?,
        };
        Ok(RunnerConfig {
            node_binary: self.node_binary,
            runner_entry: self.runner_entry,
            temporal_address: self.temporal_address,
            stigmer_endpoint: self.stigmer_endpoint,
            temporal_namespace: self.temporal_namespace,
            stigmer_token: self.stigmer_token,
            cursor_api_key: self.cursor_api_key,
            workspace_root_dir: Some(workspace_root_dir),
            proxy_endpoint: self.proxy_endpoint,
        })
    }
}

/// `~/.stigmer/desktop/workspace`, created if missing. The desktop's default agent
/// filesystem location when the frontend does not override it.
fn default_workspace_dir() -> Result<String, String> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "Cannot determine home directory for workspace".to_string())?;
    let dir = std::path::PathBuf::from(home)
        .join(".stigmer")
        .join("desktop")
        .join("workspace");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create workspace dir: {e}"))?;
    Ok(dir.to_string_lossy().to_string())
}

/// camelCase status as the JS frontend reads it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunnerStatusResponse {
    pub running: bool,
    pub active_sessions: Vec<String>,
    pub active_workflow_executions: Vec<String>,
}

impl From<RunnerStatus> for RunnerStatusResponse {
    fn from(status: RunnerStatus) -> Self {
        Self {
            running: status.running,
            active_sessions: status.active_sessions,
            active_workflow_executions: status.active_workflow_executions,
        }
    }
}

#[tauri::command]
pub async fn start_runner(
    state: State<'_, RunnerState>,
    config: RunnerConfigInput,
) -> Result<(), String> {
    let core = config.into_core()?;
    state.host.start(core).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_runner(state: State<'_, RunnerState>) -> Result<(), String> {
    state.host.stop().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_session(
    state: State<'_, RunnerState>,
    session_id: String,
) -> Result<String, String> {
    state
        .host
        .add_session(&session_id)
        .await
        .map_err(|e| e.to_string())?;
    // Synthetic local handle the frontend has always received; the SDK adapter ignores the
    // value. Preserved to keep the desktop command contract byte-for-byte.
    Ok(format!("session:{session_id}"))
}

#[tauri::command]
pub async fn remove_session(
    state: State<'_, RunnerState>,
    session_id: String,
) -> Result<(), String> {
    state
        .host
        .remove_session(&session_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn add_workflow_execution(
    state: State<'_, RunnerState>,
    execution_id: String,
) -> Result<String, String> {
    state
        .host
        .add_workflow_execution(&execution_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(format!("wfexec:{execution_id}"))
}

#[tauri::command]
pub async fn remove_workflow_execution(
    state: State<'_, RunnerState>,
    execution_id: String,
) -> Result<(), String> {
    state
        .host
        .remove_workflow_execution(&execution_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_runner_token(
    state: State<'_, RunnerState>,
    token: Option<String>,
) -> Result<(), String> {
    state
        .host
        .update_token(token)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn runner_status(state: State<'_, RunnerState>) -> Result<RunnerStatusResponse, String> {
    Ok(state.host.status().await.into())
}
