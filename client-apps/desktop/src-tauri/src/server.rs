//! Which Stigmer server the app talks to.
//!
//! One app serves Stigmer Cloud and any company's own server: the person
//! chooses the server ("Use another server" on the sign-in screen, "Change
//! server" in the user menu), and the server then says how to sign in
//! (`getServerInfo`'s `native_sign_in`). A build names only its default, the
//! webview's `VITE_STIGMER_API_URL`.
//!
//! This module owns the choice:
//! - [`validate`] decides which addresses are allowed: `https` to any host,
//!   or `http` to this machine only, so sign-in tokens never cross a network
//!   in clear. It is pure and tested.
//! - The choice is saved as `server.json` in the app's config directory. It
//!   holds no secret; the keys live in the keychain (`session_store.rs`).
//! - The webview reaches a server through the HTTP plugin, whose static
//!   permission (`capabilities/default.json`) names Stigmer's own hosts and
//!   localhost. A chosen server is granted for exactly its origin as a
//!   runtime capability ([`grant`]), never a wildcard that would let a
//!   script in the page reach any address on the person's network. Runtime
//!   capabilities are not persisted, so `setup` grants the saved origin again
//!   at every launch, before the window loads; and they cannot be removed,
//!   so an origin chosen earlier in a run stays reachable until the app
//!   quits.

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::ipc::CapabilityBuilder;
use tauri::{AppHandle, Manager, Runtime};
use url::{Host, Url};

use crate::window::MAIN_WINDOW;

const SAVED_FILE: &str = "server.json";

/// The hosts `http` may name: this machine, and nothing else.
fn is_loopback(host: &Host<&str>) -> bool {
    match host {
        Host::Domain(name) => name.eq_ignore_ascii_case("localhost"),
        Host::Ipv4(ip) => ip.is_loopback(),
        Host::Ipv6(ip) => ip.is_loopback(),
    }
}

/// The server's origin (`scheme://host[:port]`) when `input` is an address
/// the app may use, or the reason it may not, in the person's words.
pub(crate) fn validate(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Type the address of a Stigmer server, like https://stigmer.example.com.".into());
    }
    // A bare host ("stigmer.example.com") means https, the only scheme
    // another machine may be reached with.
    let candidate = if trimmed.contains("://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let url = Url::parse(&candidate)
        .map_err(|_| format!("{trimmed} is not a web address. Type one like https://stigmer.example.com."))?;
    let host = url
        .host()
        .ok_or_else(|| format!("{trimmed} names no host. Type one like https://stigmer.example.com."))?;
    match url.scheme() {
        "https" => {}
        "http" if is_loopback(&host) => {}
        "http" => {
            return Err(format!(
                "{trimmed} uses http, which would send your sign-in in clear across the network. Use its https address; http is allowed only for this computer (localhost)."
            ))
        }
        other => {
            return Err(format!(
                "{trimmed} uses {other}:, not a web address. Type one like https://stigmer.example.com."
            ))
        }
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(format!(
            "{trimmed} carries a user name or password. Type the server's address alone; you sign in after."
        ));
    }
    if (url.path() != "/" && !url.path().is_empty()) || url.query().is_some() || url.fragment().is_some() {
        return Err(format!(
            "{trimmed} has a path. Type the server's address alone, like https://stigmer.example.com."
        ));
    }
    Ok(url.origin().ascii_serialization())
}

#[derive(Serialize, Deserialize)]
struct Saved {
    url: String,
}

/// The chosen server, if the person chose one; managed by the app.
pub struct ServerChoice(Mutex<Option<String>>);

impl ServerChoice {
    /// Reads the saved choice. A missing file is no choice; a saved address
    /// that no longer passes [`validate`] is ignored, so the build's default
    /// applies.
    pub fn load<R: Runtime>(app: &AppHandle<R>) -> Self {
        let saved = saved_path(app)
            .and_then(|path| std::fs::read_to_string(path).ok())
            .and_then(|text| serde_json::from_str::<Saved>(&text).ok())
            .and_then(|saved| validate(&saved.url).ok());
        Self(Mutex::new(saved))
    }

    fn get(&self) -> Option<String> {
        self.0.lock().ok().and_then(|guard| guard.clone())
    }
}

fn saved_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|dir| dir.join(SAVED_FILE))
}

/// Lets the webview's HTTP plugin reach exactly this origin.
pub(crate) fn grant<R: Runtime>(app: &AppHandle<R>, origin: &str) -> Result<(), String> {
    #[derive(Serialize)]
    struct UrlScope {
        url: String,
    }
    let capability = CapabilityBuilder::new(format!("chosen-server-{}", capability_suffix(origin)))
        .window(MAIN_WINDOW)
        .permission_scoped(
            "http:default",
            vec![UrlScope {
                url: format!("{origin}/**"),
            }],
            Vec::new(),
        );
    app.add_capability(capability)
        .map_err(|e| format!("The app could not allow itself to reach {origin}: {e}"))
}

/// A capability identifier is letters, digits and dashes.
fn capability_suffix(origin: &str) -> String {
    origin
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect()
}

/// Grants the saved origin again; called from `setup`, before the window loads.
pub fn grant_saved<R: Runtime>(app: &AppHandle<R>) {
    if let Some(origin) = app.state::<ServerChoice>().get() {
        if let Err(reason) = grant(app, &origin) {
            eprintln!("stigmer: {reason}");
        }
    }
}

/// The server the app talks to: the person's choice, else the build's
/// default (`build_default`, which the webview passes from its own build
/// settings). Answers the origin, granted.
#[tauri::command]
pub fn current_server<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, ServerChoice>,
    build_default: String,
) -> Result<String, String> {
    let origin = match state.get() {
        Some(origin) => origin,
        None => validate(&build_default)
            .map_err(|reason| format!("This build's server address is not usable: {reason}"))?,
    };
    grant(&app, &origin)?;
    Ok(origin)
}

/// Makes `url` the server the app talks to: validated, saved, granted.
/// Answers its origin, or why it cannot be used.
#[tauri::command]
pub fn choose_server<R: Runtime>(
    app: AppHandle<R>,
    state: tauri::State<'_, ServerChoice>,
    url: String,
) -> Result<String, String> {
    let origin = validate(&url)?;
    grant(&app, &origin)?;
    let path = saved_path(&app).ok_or("The app cannot find its settings folder to remember this server.")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("The app could not remember this server ({}): {e}", dir.display()))?;
    }
    let text = serde_json::to_string(&Saved { url: origin.clone() })
        .map_err(|e| format!("The app could not remember this server: {e}"))?;
    std::fs::write(&path, text)
        .map_err(|e| format!("The app could not remember this server ({}): {e}", path.display()))?;
    if let Ok(mut guard) = state.0.lock() {
        *guard = Some(origin.clone());
    }
    Ok(origin)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_https_address_becomes_its_origin() {
        assert_eq!(validate("https://stigmer.acme.internal").as_deref(), Ok("https://stigmer.acme.internal"));
        assert_eq!(validate("https://stigmer.acme.internal/").as_deref(), Ok("https://stigmer.acme.internal"));
        assert_eq!(validate("  https://Stigmer.Acme.Internal:8443  ").as_deref(), Ok("https://stigmer.acme.internal:8443"));
    }

    #[test]
    fn a_bare_host_means_https() {
        assert_eq!(validate("stigmer.acme.internal").as_deref(), Ok("https://stigmer.acme.internal"));
    }

    #[test]
    fn http_is_allowed_to_this_computer_only() {
        assert_eq!(validate("http://localhost:7234").as_deref(), Ok("http://localhost:7234"));
        assert_eq!(validate("http://127.0.0.1:7234").as_deref(), Ok("http://127.0.0.1:7234"));
        assert_eq!(validate("http://[::1]:7234").as_deref(), Ok("http://[::1]:7234"));
        let refused = validate("http://stigmer.acme.internal").unwrap_err();
        assert!(refused.contains("in clear"), "{refused}");
        assert!(validate("http://10.0.0.5:7234").is_err());
    }

    #[test]
    fn an_address_that_is_not_a_server_says_why() {
        assert!(validate("").unwrap_err().starts_with("Type the address"));
        assert!(validate("ftp://files.acme.internal").unwrap_err().contains("ftp:"));
        assert!(validate("https://ada:secret@stigmer.acme.internal").unwrap_err().contains("user name or password"));
        assert!(validate("https://stigmer.acme.internal/console").unwrap_err().contains("has a path"));
        assert!(validate("https://stigmer.acme.internal/?x=1").unwrap_err().contains("has a path"));
        assert!(validate("https://").is_err());
    }

    #[test]
    fn a_capability_identifier_is_letters_digits_and_dashes() {
        assert_eq!(capability_suffix("http://127.0.0.1:7234"), "http---127-0-0-1-7234");
        assert_eq!(capability_suffix("https://Stigmer.Example"), "https---stigmer-example");
    }
}
