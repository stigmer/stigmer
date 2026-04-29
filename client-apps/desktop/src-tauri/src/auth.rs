use serde::Serialize;
use tauri::{Emitter, Manager};

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

// ── One-shot localhost callback servers ──────────────────────────────
//
// Both Auth0 and GitHub OAuth flows need a localhost HTTP server to
// receive the redirect callback when `window.open()` is unavailable
// (Tauri webview). The shared `start_oauth_callback_server` helper
// handles the TCP plumbing; the public Tauri commands configure the
// event name and port range for each provider.

/// Auth0 callback server for dev mode.
///
/// In dev mode the `stigmer://` deep link is typically owned by the
/// production `.app` bundle in `/Applications`, so the callback never
/// reaches the dev instance. This server provides an alternative
/// redirect URI (`http://127.0.0.1:<port>/auth/callback`) that works
/// regardless of which `.app` is installed.
#[tauri::command]
pub async fn start_auth_callback_server(app: tauri::AppHandle) -> Result<u16, String> {
    start_oauth_callback_server(app, "auth-callback", &[17234, 17235, 17236])
}

/// GitHub OAuth callback server.
///
/// The Tauri webview blocks `window.open()`, so the GitHub OAuth flow
/// opens the authorization URL in the system browser and routes the
/// callback to this localhost server. The frontend listens for the
/// `github-callback` event to complete the token exchange.
#[tauri::command]
pub async fn start_github_callback_server(app: tauri::AppHandle) -> Result<u16, String> {
    start_oauth_callback_server(app, "github-callback", &[17237, 17238, 17239])
}

/// Starts a one-shot localhost HTTP server that waits for a single
/// OAuth callback request, extracts `code` / `state` / `error` query
/// parameters, emits them as a Tauri event, and responds with a
/// "you can close this tab" HTML page.
///
/// Returns the port the server is listening on.
fn start_oauth_callback_server(
    app: tauri::AppHandle,
    event_name: &'static str,
    ports: &[u16],
) -> Result<u16, String> {
    use std::io::{Read, Write};
    use std::net::TcpListener;

    let mut listener_result: Result<TcpListener, std::io::Error> =
        Err(std::io::Error::new(std::io::ErrorKind::AddrInUse, "no ports provided"));

    for &port in ports {
        match TcpListener::bind(format!("127.0.0.1:{port}")) {
            Ok(l) => {
                listener_result = Ok(l);
                break;
            }
            Err(e) => listener_result = Err(e),
        }
    }

    let listener = listener_result
        .map_err(|e| format!("Failed to bind {event_name} callback server: {e}"))?;

    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local address: {e}"))?
        .port();

    std::thread::spawn(move || {
        let Ok((mut stream, _)) = listener.accept() else {
            return;
        };

        let mut buf = vec![0u8; 8192];
        let n = stream.read(&mut buf).unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..n]);

        let payload = parse_callback_request(&request);
        let _ = app.emit(event_name, payload);

        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.set_focus();
        }

        let html = concat!(
            "<!DOCTYPE html><html><body style=\"font-family:system-ui;display:flex;",
            "align-items:center;justify-content:center;min-height:100vh;",
            "background:#09090b;color:#fafafa;margin:0\">",
            "<div style=\"text-align:center\">",
            "<h2>Authentication complete</h2>",
            "<p style=\"color:#a1a1aa\">You can close this tab and return to Stigmer Desktop.</p>",
            "</div></body></html>",
        );
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            html.len(),
            html,
        );
        let _ = stream.write_all(response.as_bytes());
        let _ = stream.flush();
    });

    Ok(port)
}

/// Extract OAuth query parameters from the raw HTTP request line.
fn parse_callback_request(request: &str) -> AuthCallbackPayload {
    let path = request
        .lines()
        .next()
        .unwrap_or("")
        .split_whitespace()
        .nth(1)
        .unwrap_or("");

    match url::Url::parse(&format!("http://localhost{path}")) {
        Ok(url) => AuthCallbackPayload {
            code: param(&url, "code"),
            state: param(&url, "state"),
            error: param(&url, "error"),
            error_description: param(&url, "error_description"),
        },
        Err(_) => AuthCallbackPayload {
            code: None,
            state: None,
            error: Some("parse_error".into()),
            error_description: Some("Failed to parse auth callback URL".into()),
        },
    }
}

pub(crate) fn param(url: &url::Url, key: &str) -> Option<String> {
    url.query_pairs()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.into_owned())
}
