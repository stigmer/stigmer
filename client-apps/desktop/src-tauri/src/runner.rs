//! Embedded runner lifecycle — thin binding over the `stigmer-runner-host` crate, plus the
//! one piece of host policy the crate cannot own: which Node runs the runner.
//!
//! The driver (spawn, versioned `ready` handshake, IPC, shutdown) lives in the reusable
//! `stigmer-runner-host` crate; this file re-exports its Tauri command surface so
//! `lib.rs` registration and the frontend's command names stay unchanged.
//!
//! Glob (not named) re-export is deliberate: `#[tauri::command]` generates a hidden
//! `__cmd__*` ident that `generate_handler!` resolves by path, and only a glob `pub use`
//! carries it alongside the function.
//!
//! The runner's engine is the Node runtime this build carries, staged into the bundle by
//! `scripts/stage-node-runtime.sh` (pinned in `node-runtime.json`, signed with the app on
//! macOS). The app spawns the runner from that file and no other: a GUI-launched app does
//! not inherit the shell's PATH, so a `node` found by name is whatever the session happens
//! to offer, usually nothing (stigmer/stigmer#1068). [`bundled_node_path`] is how the
//! frontend learns the absolute path, the same way it resolves the runner entry.

use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

pub use stigmer_runner_host::tauri::*;

/// The bundled engine's location relative to the resource directory, spelled for this
/// platform (`node`, or `node.exe` on Windows).
fn bundled_node_relative_path() -> String {
    format!("resources/runtime/node{}", std::env::consts::EXE_SUFFIX)
}

/// Absolute path of the Node runtime this build carries, for `RunnerConfig::node_binary`.
/// Errors, in the house form, when the build carries none: staging is a build step, so a
/// missing engine means the app was built without it, never that the user lacks Node.
#[tauri::command]
pub fn bundled_node_path(app: AppHandle) -> Result<String, String> {
    let relative = bundled_node_relative_path();
    let path = app
        .path()
        .resolve(&relative, BaseDirectory::Resource)
        .map_err(|e| {
            format!("Cannot locate the app's resource directory to find its Node runtime: {e}")
        })?;
    if !path.is_file() {
        return Err(format!(
            "This build of Stigmer carries no Node runtime: {} does not exist. The runner's \
             engine is staged at build time by scripts/stage-node-runtime.sh (run by \
             stage-runner-slim.sh and setup-runner-dev.sh); rebuild with `make build-desktop`, \
             or run `client-apps/desktop/scripts/setup-runner-dev.sh` before `make launch-desktop`.",
            path.display()
        ));
    }
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundled_node_relative_path_matches_the_staged_layout() {
        // stage-node-runtime.sh writes resources/runtime/node, or node.exe on Windows.
        let expected = if cfg!(windows) {
            "resources/runtime/node.exe"
        } else {
            "resources/runtime/node"
        };
        assert_eq!(bundled_node_relative_path(), expected);
    }
}
