use serde::Serialize;
use tauri::Emitter;

#[derive(Clone, Serialize)]
pub(crate) struct AuthCallbackPayload {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
    pub error_description: Option<String>,
}

/// Opens the authorization URL in the user's default system browser.
///
/// The browser handles the full OIDC flow (Auth0 → Google → passkey /
/// Touch ID). After authentication, Auth0 redirects to the
/// `stigmer://auth/callback` custom scheme, which the OS routes back
/// to the app via the deep-link plugin. The deep-link handler in
/// `lib.rs` emits the `auth-callback` event to complete the flow.
#[tauri::command]
pub async fn open_auth_in_browser(app: tauri::AppHandle, auth_url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(&auth_url, None::<&str>)
        .map_err(|e| format!("Failed to open browser: {e}"))
}

/// Emits `auth-cancelled` so the frontend's pending login promise
/// settles gracefully when the user dismisses the sign-in flow.
#[tauri::command]
pub async fn cancel_auth(app: tauri::AppHandle) -> Result<(), String> {
    let _ = app.emit("auth-cancelled", ());
    Ok(())
}

pub(crate) fn param(url: &url::Url, key: &str) -> Option<String> {
    url.query_pairs()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.into_owned())
}
