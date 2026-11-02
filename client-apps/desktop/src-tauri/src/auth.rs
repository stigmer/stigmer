use serde::Serialize;
use tauri::Emitter;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct AuthCallbackPayload {
    pub code: Option<String>,
    pub state: Option<String>,
    pub error: Option<String>,
    pub error_description: Option<String>,
}

/// Sign-in callback server: the loopback page a sign-in at an address
/// (GitHub's among them) returns to in local and development builds.
///
/// The Tauri webview blocks `window.open()`, so the app opens the login
/// page in the system browser with the server's loopback redirect
/// (`http://127.0.0.1:<port>/auth/oauth/callback`, RFC 8252 section 7.3)
/// and receives the callback here. The frontend listens for the
/// `sign-in-callback` event to complete the sign-in.
#[tauri::command]
pub async fn start_sign_in_callback_server(app: tauri::AppHandle) -> Result<u16, String> {
    start_oauth_callback_server(&[17237, 17238, 17239], "sign-in-callback", move |payload| {
        let _ = app.emit("sign-in-callback", payload);
        crate::window::bring_forward(&app);
    })
}

/// Starts a one-shot localhost HTTP server on the first free port of
/// `ports` that waits for a single OAuth callback request, hands its
/// `code` / `state` / `error` query parameters to `on_callback`, and
/// answers with a "you can close this tab" page. Used by the GitHub
/// sign-in above and by a debug build's own sign-in (`oidc.rs`), whose
/// `stigmer://` deep link usually belongs to an installed release app.
///
/// Returns the port the server is listening on.
pub(crate) fn start_oauth_callback_server(
    ports: &[u16],
    label: &str,
    on_callback: impl FnOnce(AuthCallbackPayload) + Send + 'static,
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

    let listener =
        listener_result.map_err(|e| format!("Failed to bind the {label} callback server: {e}"))?;

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

        on_callback(parse_callback_request(&request));

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

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(request: &str) -> AuthCallbackPayload {
        parse_callback_request(request)
    }

    #[test]
    fn a_callback_request_carries_its_code_and_state() {
        let payload =
            parsed("GET /auth/callback?code=c-1&state=s-1 HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
        assert_eq!(payload.code.as_deref(), Some("c-1"));
        assert_eq!(payload.state.as_deref(), Some("s-1"));
        assert_eq!(payload.error, None);
    }

    #[test]
    fn a_callback_request_carries_the_providers_error_decoded() {
        let payload = parsed(
            "GET /auth/callback?error=access_denied&error_description=Denied%20by%20user&state=s HTTP/1.1\r\n\r\n",
        );
        assert_eq!(payload.error.as_deref(), Some("access_denied"));
        assert_eq!(payload.error_description.as_deref(), Some("Denied by user"));
        assert_eq!(payload.code, None);
    }

    #[test]
    fn a_missing_state_reads_as_none_for_the_web_layer_to_refuse() {
        let payload = parsed("GET /auth/callback?code=c HTTP/1.1\r\n\r\n");
        assert_eq!(payload.code.as_deref(), Some("c"));
        assert_eq!(payload.state, None);
    }

    #[test]
    fn only_the_request_line_is_read() {
        // A header that looks like a query must not supply a code.
        let payload =
            parsed("GET /auth/callback HTTP/1.1\r\nX-Evil: /?code=forged&state=s\r\n\r\n");
        assert_eq!(payload.code, None);
        assert_eq!(payload.state, None);
    }

    #[test]
    fn an_empty_request_or_one_with_no_path_carries_nothing() {
        for request in ["", "GET", "\r\n\r\n"] {
            let payload = parsed(request);
            assert_eq!(
                (payload.code, payload.state, payload.error),
                (None, None, None),
                "{request:?}"
            );
        }
    }

    #[test]
    fn a_path_that_makes_no_url_is_reported_as_a_parse_error() {
        // The path is appended to `http://localhost`, so a leading `:` makes
        // it a port, and one out of range makes no URL at all.
        let payload = parsed("GET :99999/auth/callback?code=c HTTP/1.1\r\n\r\n");
        assert_eq!(payload.code, None);
        assert_eq!(payload.error.as_deref(), Some("parse_error"));
        assert_eq!(
            payload.error_description.as_deref(),
            Some("Failed to parse auth callback URL")
        );
    }

    #[test]
    fn the_method_is_not_checked() {
        // The loopback server answers whatever method arrives; only the query
        // matters. Pinned so that a change to that is deliberate.
        let payload = parsed("POST /auth/callback?code=c&state=s HTTP/1.1\r\n\r\n");
        assert_eq!(payload.code.as_deref(), Some("c"));
    }
}
