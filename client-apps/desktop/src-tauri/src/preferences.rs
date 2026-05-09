use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunnerPreference {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub prompted: bool,
}

impl Default for RunnerPreference {
    fn default() -> Self {
        Self {
            enabled: false,
            prompted: false,
        }
    }
}

fn preferences_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("could not resolve home directory")?;
    Ok(home.join(".stigmer").join("desktop").join("preferences.json"))
}

#[tauri::command]
pub async fn get_runner_preference() -> Result<RunnerPreference, String> {
    let path = preferences_path()?;
    if !path.exists() {
        return Ok(RunnerPreference::default());
    }
    let data = fs::read_to_string(&path)
        .map_err(|e| format!("failed to read preferences: {e}"))?;
    serde_json::from_str(&data)
        .map_err(|e| format!("failed to parse preferences: {e}"))
}

#[tauri::command]
pub async fn set_runner_preference(enabled: Option<bool>, prompted: Option<bool>) -> Result<(), String> {
    let path = preferences_path()?;
    let mut pref = if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|d| serde_json::from_str(&d).ok())
            .unwrap_or_default()
    } else {
        RunnerPreference::default()
    };

    if let Some(e) = enabled {
        pref.enabled = e;
    }
    if let Some(p) = prompted {
        pref.prompted = p;
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("failed to create preferences directory: {e}"))?;
    }

    let json = serde_json::to_string_pretty(&pref)
        .map_err(|e| format!("failed to serialize preferences: {e}"))?;
    fs::write(&path, json)
        .map_err(|e| format!("failed to write preferences: {e}"))?;

    Ok(())
}
