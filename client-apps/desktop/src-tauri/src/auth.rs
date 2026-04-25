use serde::Serialize;
use tauri::webview::WebviewBuilder;
use tauri::{Emitter, LogicalPosition, Manager, WebviewUrl};

const AUTH_OVERLAY_LABEL: &str = "auth-overlay";

#[derive(Clone, Serialize)]
struct AuthCallbackPayload {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

/// Shows Auth0's Universal Login as a full-window overlay webview inside
/// the main window.
///
/// Creates a child webview that covers the entire main window content
/// area, navigating to the Auth0 authorize URL. When Auth0 redirects to
/// `stigmer://auth/callback`, the `on_navigation` handler intercepts
/// the redirect, emits an `auth-callback` event, and removes the
/// overlay — revealing the React app underneath.
#[tauri::command]
pub async fn open_auth_window(app: tauri::AppHandle, auth_url: String) -> Result<(), String> {
    if let Some(existing) = app.get_webview(AUTH_OVERLAY_LABEL) {
        let _ = existing.close();
    }

    let parsed_url: url::Url = auth_url
        .parse()
        .map_err(|e| format!("Invalid auth URL: {e}"))?;

    let main_window = app
        .get_window("main")
        .ok_or("Main window not found")?;

    let nav_app = app.clone();

    let scale_factor = main_window
        .scale_factor()
        .map_err(|e| format!("Failed to get scale factor: {e}"))?;
    let physical_size = main_window
        .inner_size()
        .map_err(|e| format!("Failed to get window size: {e}"))?;
    let logical_size = physical_size.to_logical::<f64>(scale_factor);

    main_window
        .add_child(
            WebviewBuilder::new(AUTH_OVERLAY_LABEL, WebviewUrl::External(parsed_url))
                .auto_resize()
                .on_navigation(move |url| {
                    if url.scheme() != "stigmer" {
                        return true;
                    }

                    let is_auth_callback =
                        url.host_str() == Some("auth") && url.path() == "/callback";

                    if !is_auth_callback {
                        return false;
                    }

                    let payload = AuthCallbackPayload {
                        code: param(url, "code"),
                        state: param(url, "state"),
                        error: param(url, "error"),
                        error_description: param(url, "error_description"),
                    };

                    let _ = nav_app.emit("auth-callback", payload);

                    if let Some(webview) = nav_app.get_webview(AUTH_OVERLAY_LABEL) {
                        let _ = webview.close();
                    }

                    false
                }),
            LogicalPosition::new(0.0, 0.0),
            logical_size,
        )
        .map_err(|e| format!("Failed to create auth overlay: {e}"))?;

    Ok(())
}

/// Removes the auth overlay webview if present and emits `auth-cancelled`
/// so the frontend's pending login promise settles gracefully.
#[tauri::command]
pub async fn close_auth_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(webview) = app.get_webview(AUTH_OVERLAY_LABEL) {
        webview
            .close()
            .map_err(|e| format!("Failed to close auth overlay: {e}"))?;
        let _ = app.emit("auth-cancelled", ());
    }
    Ok(())
}

fn param(url: &url::Url, key: &str) -> Option<String> {
    url.query_pairs()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.into_owned())
}
