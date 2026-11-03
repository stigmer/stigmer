//! The one way the app brings its window forward.
//!
//! Everything that should put the person back in front of Stigmer (a second
//! launch, a deep link, the sign-in callback, the tray's "Open Stigmer", a
//! click on the Dock icon, a notification click, the start-up fallback) calls
//! [`bring_forward`]. One function means one behaviour: a hidden window is
//! shown, a minimized one restored, and either takes focus. Before it there
//! were five copies, and two of them forgot to restore a minimized window.

use tauri::{AppHandle, Manager, Runtime};

/// The label of the app's only window (`tauri.conf.json`, `app.windows`).
pub(crate) const MAIN_WINDOW: &str = "main";

/// Shows, restores and focuses the main window. Does nothing when the window
/// is gone, which only happens in a dev build after its window was closed
/// (`lifecycle.rs`). Each step is best-effort: a window manager that refuses
/// focus still leaves the window shown.
pub(crate) fn bring_forward<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// `bring_forward` for the webview: a notification click brings the window
/// forward before the app opens the conversation it is about.
#[tauri::command]
pub fn show_main_window<R: Runtime>(app: AppHandle<R>) {
    bring_forward(&app);
}
