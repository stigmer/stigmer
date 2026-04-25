use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use tauri::webview::WebviewWindowBuilder;
use tauri::{Emitter, Manager, WebviewUrl};

const AUTH_WINDOW_LABEL: &str = "auth";

#[derive(Clone, Serialize)]
struct AuthCallbackPayload {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

/// Opens a secondary webview window that navigates to the Auth0 authorize URL.
///
/// The window intercepts the `stigmer://auth/callback` redirect via
/// `on_navigation`, extracts the authorization code (or error), emits an
/// `auth-callback` event to the main window, and closes itself.
///
/// If the user closes the window before completing login, an
/// `auth-cancelled` event is emitted so the frontend can silently return
/// to the login screen.
#[tauri::command]
pub async fn open_auth_window(app: tauri::AppHandle, auth_url: String) -> Result<(), String> {
    if app.get_webview_window(AUTH_WINDOW_LABEL).is_some() {
        return Err("Auth window is already open".into());
    }

    let parsed_url: url::Url = auth_url
        .parse()
        .map_err(|e| format!("Invalid auth URL: {e}"))?;

    let callback_handled = Arc::new(AtomicBool::new(false));
    let nav_app = app.clone();
    let nav_handled = callback_handled.clone();

    let auth_window = WebviewWindowBuilder::new(
        &app,
        AUTH_WINDOW_LABEL,
        WebviewUrl::External(parsed_url),
    )
    .title("Sign in to Stigmer")
    .inner_size(480.0, 700.0)
    .min_inner_size(400.0, 500.0)
    .center()
    .on_navigation(move |url| {
        if url.scheme() != "stigmer" {
            return true;
        }

        let is_auth_callback =
            url.host_str() == Some("auth") && url.path() == "/callback";

        if !is_auth_callback {
            return false;
        }

        nav_handled.store(true, Ordering::SeqCst);

        let payload = AuthCallbackPayload {
            code: param(url, "code"),
            state: param(url, "state"),
            error: param(url, "error"),
            error_description: param(url, "error_description"),
        };

        let _ = nav_app.emit("auth-callback", payload);

        if let Some(win) = nav_app.get_webview_window(AUTH_WINDOW_LABEL) {
            let _ = win.close();
        }

        false
    })
    .build()
    .map_err(|e| format!("Failed to open auth window: {e}"))?;

    let _ = auth_window.set_focus();

    let close_app = app.clone();
    auth_window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            if !callback_handled.load(Ordering::SeqCst) {
                let _ = close_app.emit("auth-cancelled", ());
            }
        }
    });

    Ok(())
}

fn param(url: &url::Url, key: &str) -> Option<String> {
    url.query_pairs()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.into_owned())
}
