//! Signing a person in to the server the app points at, in Rust.
//!
//! The server says how ([`NativeSignIn`], from `getServerInfo`'s
//! `native_sign_in`): its identity provider's issuer, the audience its
//! access tokens carry, and the public native client registered for
//! installed apps. Nothing about any provider is built into the app.
//!
//! The whole flow runs here, so the PKCE verifier, the `state` and the
//! refresh token never reach the webview:
//! 1. discovery: the issuer's `/.well-known/openid-configuration`, whose
//!    `issuer` must equal the announced one exactly (the server's own reader
//!    holds the same rule) and whose endpoints must be `https`, or `http` on
//!    this machine;
//! 2. the authorize URL ([`authorize_url`], pure): S256 PKCE, a fresh
//!    `state`, `openid profile email offline_access`, `prompt=login`, and
//!    `audience`, which Auth0 needs to mint an access token for the API and
//!    other providers ignore;
//! 3. the person's own browser, so passkeys and their provider's session
//!    work; the redirect is `stigmer://auth/callback` (the deep link,
//!    `lib.rs`) or, in a debug build, a loopback port 17234-17236
//!    (`auth.rs`), both delivered to [`deliver`], which hands the callback to
//!    the pending flow whose `state` it carries and to no other;
//! 4. the code exchange, then refreshes and the revoke at sign-out, at the
//!    endpoints discovery named, through the HTTP client the HTTP plugin
//!    re-exports (one client, one trust store, the system's included).
//!
//! The webview's whole view of a session is [`SessionView`]: the access
//! token, its expiry and the person's display claims. The refresh token is
//! kept in the keychain (`session_store.rs`).

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_http::reqwest;
use tokio::sync::oneshot;
use url::{Host, Url};

use crate::auth::AuthCallbackPayload;
use crate::session_store::{Person, SessionStore, StoredSession};

/// The deep link a release build's sign-in returns to.
pub(crate) const DEEP_LINK_REDIRECT: &str = "stigmer://auth/callback";
/// The loopback ports a debug build's sign-in returns to (the estate's
/// native clients register the same three).
pub(crate) const LOOPBACK_PORTS: [u16; 3] = [17234, 17235, 17236];
const SCOPES: &str = "openid profile email offline_access";
/// How long the browser may take before the app stops waiting.
const SIGN_IN_TIMEOUT: Duration = Duration::from_secs(5 * 60);
/// An access token this close to its expiry is refreshed instead of used.
const EXPIRY_MARGIN: Duration = Duration::from_secs(60);

/// How a server signs installed apps in, as `getServerInfo` announces it.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSignIn {
    pub issuer: String,
    pub audience: String,
    pub client_id: String,
}

/// Where a server sends people to sign in, as the sign-in screen shows it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderView {
    /// The provider's host, as the person will see it in the browser.
    pub host: String,
    /// Whether the provider sits on the server's own site.
    pub same_site: bool,
}

fn host_of(raw: &str) -> Option<url::Host<String>> {
    url::Url::parse(raw).ok()?.host().map(|h| h.to_owned())
}

fn is_loopback(host: &url::Host<String>) -> bool {
    match host {
        url::Host::Domain(name) => name.eq_ignore_ascii_case("localhost"),
        url::Host::Ipv4(ip) => ip.is_loopback(),
        url::Host::Ipv6(ip) => ip.is_loopback(),
    }
}

/// The registrable domain of a host name (`id.acme.co.uk` -> `acme.co.uk`),
/// by the Public Suffix List; `None` for a public suffix itself.
fn registrable(name: &str) -> Option<String> {
    let name = name.trim_end_matches('.').to_ascii_lowercase();
    psl::domain_str(&name).map(str::to_owned)
}

/// Whether `issuer` sits on `server`'s own site: the same registrable
/// domain, the same address, or both on this computer.
///
/// A server announces its sign-in provider, and a server a person was
/// talked into choosing could announce another server's (its issuer,
/// audience and public native client) to collect tokens that server
/// accepts. A provider on the server's own site cannot be borrowed that way;
/// one elsewhere is shown to the person before the browser opens.
pub(crate) fn provider_on_servers_site(server: &str, issuer: &str) -> bool {
    let (Some(server), Some(issuer)) = (host_of(server), host_of(issuer)) else {
        return false;
    };
    if is_loopback(&server) && is_loopback(&issuer) {
        return true;
    }
    match (&server, &issuer) {
        (url::Host::Domain(a), url::Host::Domain(b)) => {
            matches!((registrable(a), registrable(b)), (Some(a), Some(b)) if a == b)
        }
        _ => server == issuer,
    }
}

/// The provider's host as the person will see it, for the sign-in screen.
fn provider_view(server: &str, sign_in: &NativeSignIn) -> ProviderView {
    ProviderView {
        host: host_of(&sign_in.issuer)
            .map(|h| h.to_string())
            .unwrap_or_else(|| sign_in.issuer.clone()),
        same_site: provider_on_servers_site(server, &sign_in.issuer),
    }
}

/// Refuses a sign-in at a provider on another site unless the person was
/// shown both hosts and chose to go on.
pub(crate) fn admit_provider(
    server: &str,
    sign_in: &NativeSignIn,
    confirmed: bool,
) -> Result<(), String> {
    let provider = provider_view(server, sign_in);
    if provider.same_site || confirmed {
        return Ok(());
    }
    let server_host = host_of(server)
        .map(|h| h.to_string())
        .unwrap_or_else(|| server.to_string());
    Err(format!(
        "{server_host} signs people in at {}, on another site. The app goes there only once you choose to on the sign-in screen.",
        provider.host
    ))
}

/// The webview's whole view of a session.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    pub access_token: String,
    /// Milliseconds since the epoch, as the webview's clock reads them.
    pub expires_at: u64,
    pub user: Person,
    /// Whether the sign-in outlives the app: false when no keychain answers
    /// (or in a debug build), so the webview can say the app will ask again.
    pub kept_between_launches: bool,
}

/// The endpoints an issuer's discovery document names.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Discovery {
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub revocation_endpoint: Option<String>,
}

#[derive(Deserialize)]
struct DiscoveryDocument {
    issuer: String,
    authorization_endpoint: String,
    token_endpoint: String,
    #[serde(default)]
    revocation_endpoint: Option<String>,
}

/// Whether `raw` is an address the app may send a person or a credential
/// to: `https`, or `http` on this machine.
fn is_trusted_endpoint(raw: &str) -> bool {
    let Ok(url) = Url::parse(raw) else {
        return false;
    };
    match (url.scheme(), url.host()) {
        ("https", Some(_)) => true,
        ("http", Some(Host::Domain(name))) => name.eq_ignore_ascii_case("localhost"),
        ("http", Some(Host::Ipv4(ip))) => ip.is_loopback(),
        ("http", Some(Host::Ipv6(ip))) => ip.is_loopback(),
        _ => false,
    }
}

/// Where an issuer publishes its discovery document.
pub(crate) fn discovery_url(issuer: &str) -> String {
    format!(
        "{}/.well-known/openid-configuration",
        issuer.trim_end_matches('/')
    )
}

/// The endpoints a discovery document names, once it is the announced
/// issuer's own and every endpoint is one the app may use.
pub(crate) fn read_discovery(expected_issuer: &str, body: &str) -> Result<Discovery, String> {
    let document: DiscoveryDocument = serde_json::from_str(body).map_err(|_| {
        format!(
            "{expected_issuer} published no OpenID Connect discovery document the app can read."
        )
    })?;
    if document.issuer != expected_issuer {
        return Err(format!(
            "The sign-in provider says it is {}, but this server named {expected_issuer}. Ask the server's operator to set the issuer exactly as the provider spells it.",
            document.issuer
        ));
    }
    for endpoint in [&document.authorization_endpoint, &document.token_endpoint]
        .into_iter()
        .chain(document.revocation_endpoint.as_ref())
    {
        if !is_trusted_endpoint(endpoint) {
            return Err(format!(
                "The sign-in provider names {endpoint}, which is not https. The app signs in only over https, or http on this computer."
            ));
        }
    }
    Ok(Discovery {
        authorization_endpoint: document.authorization_endpoint,
        token_endpoint: document.token_endpoint,
        revocation_endpoint: document.revocation_endpoint,
    })
}

/// A PKCE pair: the verifier kept here, the S256 challenge sent.
pub(crate) struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

fn random_token(bytes: usize) -> Result<String, String> {
    let mut buffer = vec![0u8; bytes];
    getrandom::getrandom(&mut buffer)
        .map_err(|e| format!("The system gave the app no randomness: {e}"))?;
    Ok(URL_SAFE_NO_PAD.encode(buffer))
}

pub(crate) fn challenge_of(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn new_pkce() -> Result<Pkce, String> {
    let verifier = random_token(48)?;
    let challenge = challenge_of(&verifier);
    Ok(Pkce {
        verifier,
        challenge,
    })
}

/// The URL the person's browser opens to sign in.
pub(crate) fn authorize_url(
    discovery: &Discovery,
    sign_in: &NativeSignIn,
    redirect_uri: &str,
    state: &str,
    challenge: &str,
) -> Result<String, String> {
    let mut url = Url::parse(&discovery.authorization_endpoint).map_err(|_| {
        "The sign-in provider's authorization address is not a web address.".to_string()
    })?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &sign_in.client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("scope", SCOPES)
        .append_pair("audience", &sign_in.audience)
        .append_pair("state", state)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("prompt", "login");
    Ok(url.into())
}

/// What a callback says, for the flow that sent `expected_state`: the code,
/// or why there is none.
pub(crate) fn code_from(
    callback: &AuthCallbackPayload,
    expected_state: &str,
) -> Result<String, String> {
    if callback.state.as_deref() != Some(expected_state) {
        return Err(
            "The sign-in that came back is not the one the app started. Sign in again.".into(),
        );
    }
    if let Some(error) = &callback.error {
        return Err(callback
            .error_description
            .clone()
            .unwrap_or_else(|| format!("The sign-in provider refused the sign-in ({error}).")));
    }
    callback.code.clone().ok_or_else(|| {
        "The sign-in provider sent the app back without a sign-in. Sign in again.".to_string()
    })
}

/// The display claims of an ID token. Not verified: it came straight from
/// the token endpoint over TLS, and it only names the person on screen.
pub(crate) fn person_of(id_token: Option<&str>) -> Person {
    let claims = id_token
        .and_then(|token| token.split('.').nth(1))
        .and_then(|payload| URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok())
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .unwrap_or_default();
    let text = |key: &str| claims.get(key).and_then(|v| v.as_str()).map(str::to_owned);
    Person {
        sub: text("sub").unwrap_or_default(),
        email: text("email"),
        name: text("name"),
        picture: text("picture"),
    }
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    id_token: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
}

/// Why a token request failed: the provider refused the credential (sign in
/// again), or the provider could not be asked (try again later).
#[derive(Debug, PartialEq, Eq)]
enum TokenFailure {
    Refused(String),
    Unreachable(String),
}

impl TokenFailure {
    fn message(self) -> String {
        match self {
            TokenFailure::Refused(m) | TokenFailure::Unreachable(m) => m,
        }
    }
}

/// What a token endpoint's answer means when it is not a success: refused
/// (the session is over), or unreachable for now (keep it and try later).
/// `None` for a success.
fn token_failure(status: reqwest::StatusCode, body: &str) -> Option<TokenFailure> {
    // Only a rejected grant or client ends the session. A busy (429), slow
    // (408) or failing provider is unreachable for now.
    if status == reqwest::StatusCode::BAD_REQUEST || status == reqwest::StatusCode::UNAUTHORIZED {
        let reason = serde_json::from_str::<serde_json::Value>(body)
            .ok()
            .and_then(|v| {
                v.get("error_description")
                    .or_else(|| v.get("error"))
                    .and_then(|e| e.as_str())
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| status.to_string());
        return Some(TokenFailure::Refused(format!(
            "The sign-in provider refused the sign-in: {reason}"
        )));
    }
    if !status.is_success() {
        return Some(TokenFailure::Unreachable(format!(
            "The sign-in provider answered {status}. Try again."
        )));
    }
    None
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}

/// One flow waiting for its browser.
struct Pending {
    state: String,
    authorize_url: String,
    deliver: oneshot::Sender<AuthCallbackPayload>,
}

/// A signed-in session held in memory: the access token never leaves it but
/// for the webview's view.
#[derive(Clone)]
struct Live {
    view: SessionView,
    /// The provider this session was signed in through.
    sign_in: NativeSignIn,
}

/// The sign-in state the app manages.
pub struct SignIn {
    store: Box<dyn SessionStore>,
    http: reqwest::Client,
    pending: Mutex<Option<Pending>>,
    live: Mutex<HashMap<String, Live>>,
    discovered: Mutex<HashMap<String, Discovery>>,
}

impl SignIn {
    pub fn new(store: Box<dyn SessionStore>) -> Self {
        Self {
            store,
            http: reqwest::Client::new(),
            pending: Mutex::new(None),
            live: Mutex::new(HashMap::new()),
            discovered: Mutex::new(HashMap::new()),
        }
    }

    async fn discover(&self, issuer: &str) -> Result<Discovery, String> {
        if let Some(known) = self
            .discovered
            .lock()
            .ok()
            .and_then(|m| m.get(issuer).cloned())
        {
            return Ok(known);
        }
        if !is_trusted_endpoint(issuer) {
            return Err(format!(
                "This server's sign-in provider is {issuer}, which is not https. The app signs in only over https, or http on this computer."
            ));
        }
        let response = self
            .http
            .get(discovery_url(issuer))
            .send()
            .await
            .map_err(|e| format!("The app could not reach the sign-in provider {issuer}: {e}"))?;
        if !response.status().is_success() {
            return Err(format!(
                "The sign-in provider {issuer} answered {} for its discovery document.",
                response.status()
            ));
        }
        let body = response
            .text()
            .await
            .map_err(|e| format!("The app could not read the sign-in provider's answer: {e}"))?;
        let discovery = read_discovery(issuer, &body)?;
        if let Ok(mut known) = self.discovered.lock() {
            known.insert(issuer.to_string(), discovery.clone());
        }
        Ok(discovery)
    }

    async fn token_request(
        &self,
        endpoint: &str,
        form: &[(&str, &str)],
    ) -> Result<TokenResponse, TokenFailure> {
        let response = self
            .http
            .post(endpoint)
            .form(form)
            .send()
            .await
            .map_err(|e| {
                TokenFailure::Unreachable(format!(
                    "The app could not reach the sign-in provider: {e}"
                ))
            })?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        token_failure(status, &body).map_or(Ok(()), Err)?;
        serde_json::from_str(&body).map_err(|_| {
            TokenFailure::Unreachable("The sign-in provider's answer had no access token.".into())
        })
    }

    /// Keeps a fresh token response: in memory for the webview, and its
    /// refresh token in the store.
    fn keep(
        &self,
        origin: &str,
        sign_in: &NativeSignIn,
        tokens: TokenResponse,
        previous: Option<&StoredSession>,
    ) -> Result<SessionView, String> {
        let person = match (&tokens.id_token, previous) {
            (Some(id_token), _) => person_of(Some(id_token)),
            (None, Some(stored)) => stored.person.clone(),
            (None, None) => Person::default(),
        };
        let lifetime = tokens.expires_in.unwrap_or(3600);
        let view = SessionView {
            access_token: tokens.access_token,
            expires_at: now_ms() + lifetime * 1000,
            user: person.clone(),
            kept_between_launches: self.store.persists(),
        };
        // A provider that rotates refresh tokens sends a new one; one that
        // does not keeps the old one valid.
        let refresh = tokens
            .refresh_token
            .or_else(|| previous.map(|stored| stored.refresh_token.clone()));
        if let Some(refresh_token) = refresh {
            self.store.save(
                origin,
                &StoredSession {
                    refresh_token,
                    issuer: sign_in.issuer.clone(),
                    audience: sign_in.audience.clone(),
                    client_id: sign_in.client_id.clone(),
                    person,
                },
            )?;
        }
        if let Ok(mut live) = self.live.lock() {
            live.insert(
                origin.to_string(),
                Live {
                    view: view.clone(),
                    sign_in: sign_in.clone(),
                },
            );
        }
        Ok(view)
    }

    fn live_view(&self, origin: &str) -> Option<SessionView> {
        let live = self.live.lock().ok()?.get(origin).cloned()?;
        let fresh = live.view.expires_at > now_ms() + EXPIRY_MARGIN.as_millis() as u64;
        fresh.then_some(live.view)
    }

    /// Refreshes `origin`'s stored session. `Ok(None)` when there is none,
    /// or the provider refused it (the stored session is then forgotten).
    async fn refresh(&self, origin: &str) -> Result<Option<SessionView>, String> {
        let Some(stored) = self.store.load(origin)? else {
            return Ok(None);
        };
        let discovery = self.discover(&stored.issuer).await?;
        let form = [
            ("grant_type", "refresh_token"),
            ("client_id", stored.client_id.as_str()),
            ("refresh_token", stored.refresh_token.as_str()),
        ];
        match self.token_request(&discovery.token_endpoint, &form).await {
            Ok(tokens) => {
                let sign_in = NativeSignIn {
                    issuer: stored.issuer.clone(),
                    audience: stored.audience.clone(),
                    client_id: stored.client_id.clone(),
                };
                self.keep(origin, &sign_in, tokens, Some(&stored)).map(Some)
            }
            Err(TokenFailure::Refused(_)) => {
                self.forget(origin)?;
                Ok(None)
            }
            Err(failure) => Err(failure.message()),
        }
    }

    /// The session for `origin`, signed in through `announced`: the one in
    /// memory while its token is fresh, else a refresh of the kept one.
    async fn session_for(
        &self,
        origin: &str,
        announced: &NativeSignIn,
    ) -> Result<Option<SessionView>, String> {
        // A server that moved to another provider, audience or client
        // starts a new sign-in: a token from the old one is rejected there.
        let live_from = self
            .live
            .lock()
            .ok()
            .and_then(|live| live.get(origin).map(|l| l.sign_in.clone()));
        let stored_from = self.store.load(origin)?.map(|stored| NativeSignIn {
            issuer: stored.issuer,
            audience: stored.audience,
            client_id: stored.client_id,
        });
        if [live_from, stored_from]
            .iter()
            .flatten()
            .any(|from| from != announced)
        {
            self.forget(origin)?;
            return Ok(None);
        }
        if let Some(view) = self.live_view(origin) {
            return Ok(Some(view));
        }
        self.refresh(origin).await
    }

    fn forget(&self, origin: &str) -> Result<(), String> {
        if let Ok(mut live) = self.live.lock() {
            live.remove(origin);
        }
        self.store.delete(origin)
    }

    /// Starts waiting for one browser round trip, replacing (and cancelling)
    /// any flow still waiting.
    fn wait_for(
        &self,
        state: String,
        authorize_url: String,
    ) -> oneshot::Receiver<AuthCallbackPayload> {
        let (tx, rx) = oneshot::channel();
        if let Ok(mut pending) = self.pending.lock() {
            *pending = Some(Pending {
                state,
                authorize_url,
                deliver: tx,
            });
        }
        rx
    }

    /// Hands a callback to the flow whose `state` it carries. A callback for
    /// no waiting flow, or for another one, is dropped.
    pub(crate) fn deliver(&self, callback: AuthCallbackPayload) -> bool {
        let Ok(mut pending) = self.pending.lock() else {
            return false;
        };
        let matches = pending
            .as_ref()
            .is_some_and(|waiting| callback.state.as_deref() == Some(waiting.state.as_str()));
        if !matches {
            return false;
        }
        pending
            .take()
            .map(|waiting| waiting.deliver.send(callback).is_ok())
            .unwrap_or(false)
    }

    fn waiting_url(&self) -> Option<String> {
        self.pending
            .lock()
            .ok()?
            .as_ref()
            .map(|p| p.authorize_url.clone())
    }

    fn cancel(&self) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.take();
        }
    }
}

/// Hands a `stigmer://auth/callback` or loopback callback to the waiting flow.
pub(crate) fn deliver<R: Runtime>(app: &AppHandle<R>, callback: AuthCallbackPayload) {
    if !app.state::<SignIn>().deliver(callback) {
        eprintln!(
            "stigmer: a sign-in callback arrived for no sign-in the app is waiting for; ignored"
        );
    }
}

fn open_in_browser<R: Runtime>(app: &AppHandle<R>, url: &str) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("The app could not open your browser: {e}"))
}

/// Signs the person in to `server` through the provider it announced, and
/// answers the webview's view of the session.
#[tauri::command]
pub async fn auth_sign_in<R: Runtime>(
    app: AppHandle<R>,
    server: String,
    sign_in: NativeSignIn,
    provider_confirmed: Option<bool>,
) -> Result<SessionView, String> {
    admit_provider(&server, &sign_in, provider_confirmed.unwrap_or(false))?;
    let state = app.state::<SignIn>();
    let discovery = state.discover(&sign_in.issuer).await?;
    let pkce = new_pkce()?;
    let flow_state = random_token(24)?;

    let redirect_uri = if cfg!(debug_assertions) {
        // A dev build's deep link usually belongs to an installed release
        // app, so the callback comes back to a loopback port instead.
        let handle = app.clone();
        let port = crate::auth::start_oauth_callback_server(
            &LOOPBACK_PORTS,
            "sign-in",
            move |callback| {
                deliver(&handle, callback);
            },
        )?;
        format!("http://127.0.0.1:{port}/auth/callback")
    } else {
        DEEP_LINK_REDIRECT.to_string()
    };

    let url = authorize_url(
        &discovery,
        &sign_in,
        &redirect_uri,
        &flow_state,
        &pkce.challenge,
    )?;
    let callback = state.wait_for(flow_state.clone(), url.clone());
    open_in_browser(&app, &url)?;

    let callback = match tokio::time::timeout(SIGN_IN_TIMEOUT, callback).await {
        Ok(Ok(callback)) => callback,
        Ok(Err(_)) => return Err("Sign-in cancelled.".into()),
        Err(_) => {
            state.cancel();
            return Err(
                "The browser did not finish signing in within five minutes. Sign in again.".into(),
            );
        }
    };
    let code = code_from(&callback, &flow_state)?;
    let form = [
        ("grant_type", "authorization_code"),
        ("client_id", sign_in.client_id.as_str()),
        ("code", code.as_str()),
        ("code_verifier", pkce.verifier.as_str()),
        ("redirect_uri", redirect_uri.as_str()),
    ];
    let tokens = state
        .token_request(&discovery.token_endpoint, &form)
        .await
        .map_err(TokenFailure::message)?;
    state.keep(&server, &sign_in, tokens, None)
}

/// Where `server` sends people to sign in, and whether that is on its own
/// site, for the sign-in screen to say before the browser opens.
#[tauri::command]
pub fn auth_provider(server: String, sign_in: NativeSignIn) -> ProviderView {
    provider_view(&server, &sign_in)
}

/// Opens the waiting sign-in in the browser again.
#[tauri::command]
pub fn auth_reopen_browser<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let url = app
        .state::<SignIn>()
        .waiting_url()
        .ok_or("No sign-in is waiting for the browser.")?;
    open_in_browser(&app, &url)
}

/// Stops waiting for the browser; the waiting sign-in answers "cancelled".
#[tauri::command]
pub fn auth_cancel(state: tauri::State<'_, SignIn>) {
    state.cancel();
}

/// The session for `server` through the provider it announces now: the one
/// in memory while its token is fresh, else a refresh of the kept one, else
/// none. A session from a provider the server no longer announces is dropped.
#[tauri::command]
pub async fn auth_session(
    state: tauri::State<'_, SignIn>,
    server: String,
    sign_in: NativeSignIn,
) -> Result<Option<SessionView>, String> {
    state.session_for(&server, &sign_in).await
}

/// A new access token for `server`, ahead of the old one's expiry.
#[tauri::command]
pub async fn auth_refresh(
    state: tauri::State<'_, SignIn>,
    server: String,
) -> Result<Option<SessionView>, String> {
    state.refresh(&server).await
}

/// Signs out of `server`: forgets its session here, and revokes the refresh
/// token where the provider publishes a revocation endpoint.
#[tauri::command]
pub async fn auth_sign_out(state: tauri::State<'_, SignIn>, server: String) -> Result<(), String> {
    let stored = state.store.load(&server).ok().flatten();
    state.forget(&server)?;
    if let Some(stored) = stored {
        if let Ok(discovery) = state.discover(&stored.issuer).await {
            if let Some(endpoint) = discovery.revocation_endpoint {
                let form = [
                    ("token", stored.refresh_token.as_str()),
                    ("token_type_hint", "refresh_token"),
                    ("client_id", stored.client_id.as_str()),
                ];
                // Best effort: the session is already gone from this computer.
                let _ = state.token_request(&endpoint, &form).await;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session_store::MemoryStore;

    const ISSUER: &str = "https://id.acme.example/";

    fn discovery() -> Discovery {
        Discovery {
            authorization_endpoint: "https://id.acme.example/authorize".into(),
            token_endpoint: "https://id.acme.example/oauth/token".into(),
            revocation_endpoint: None,
        }
    }

    fn sign_in() -> NativeSignIn {
        NativeSignIn {
            issuer: ISSUER.into(),
            audience: "https://api.acme.example".into(),
            client_id: "native-1".into(),
        }
    }

    fn callback(
        code: Option<&str>,
        state: Option<&str>,
        error: Option<&str>,
    ) -> AuthCallbackPayload {
        AuthCallbackPayload {
            code: code.map(str::to_owned),
            state: state.map(str::to_owned),
            error: error.map(str::to_owned),
            error_description: None,
        }
    }

    #[test]
    fn the_authorize_url_asks_the_announced_provider_for_a_pkce_code() {
        let url = Url::parse(
            &authorize_url(
                &discovery(),
                &sign_in(),
                DEEP_LINK_REDIRECT,
                "state-1",
                "challenge-1",
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(
            url.origin().ascii_serialization(),
            "https://id.acme.example"
        );
        assert_eq!(url.path(), "/authorize");
        let query: HashMap<String, String> = url.query_pairs().into_owned().collect();
        let expected: HashMap<String, String> = [
            ("response_type", "code"),
            ("client_id", "native-1"),
            ("redirect_uri", "stigmer://auth/callback"),
            ("scope", "openid profile email offline_access"),
            ("audience", "https://api.acme.example"),
            ("state", "state-1"),
            ("code_challenge", "challenge-1"),
            ("code_challenge_method", "S256"),
            ("prompt", "login"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        assert_eq!(query, expected);
    }

    #[test]
    fn the_challenge_is_the_s256_of_the_verifier() {
        // RFC 7636, appendix B.
        assert_eq!(
            challenge_of("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        let pkce = new_pkce().unwrap();
        assert_eq!(pkce.challenge, challenge_of(&pkce.verifier));
        assert!(
            pkce.verifier.len() >= 43,
            "RFC 7636 asks for 43 to 128 characters"
        );
    }

    #[test]
    fn discovery_is_read_only_from_the_announced_issuer_itself() {
        let document = r#"{"issuer":"https://id.acme.example/","authorization_endpoint":"https://id.acme.example/authorize","token_endpoint":"https://id.acme.example/oauth/token","revocation_endpoint":"https://id.acme.example/oauth/revoke"}"#;
        let read = read_discovery(ISSUER, document).unwrap();
        assert_eq!(read.token_endpoint, "https://id.acme.example/oauth/token");
        assert_eq!(
            read.revocation_endpoint.as_deref(),
            Some("https://id.acme.example/oauth/revoke")
        );

        // The trailing slash is part of the issuer: Auth0's has one.
        let refused = read_discovery("https://id.acme.example", document).unwrap_err();
        assert!(
            refused.contains("says it is https://id.acme.example/"),
            "{refused}"
        );
    }

    #[test]
    fn discovery_that_sends_a_person_or_a_credential_over_plain_http_is_refused() {
        let document = r#"{"issuer":"https://id.acme.example/","authorization_endpoint":"http://id.acme.example/authorize","token_endpoint":"https://id.acme.example/oauth/token"}"#;
        assert!(read_discovery(ISSUER, document)
            .unwrap_err()
            .contains("not https"));
        let local = r#"{"issuer":"http://127.0.0.1:9000","authorization_endpoint":"http://127.0.0.1:9000/authorize","token_endpoint":"http://localhost:9000/token"}"#;
        assert!(read_discovery("http://127.0.0.1:9000", local).is_ok());
        assert!(read_discovery(ISSUER, "<html>")
            .unwrap_err()
            .contains("no OpenID Connect discovery document"));
    }

    #[test]
    fn the_discovery_document_sits_under_the_issuer() {
        assert_eq!(
            discovery_url(ISSUER),
            "https://id.acme.example/.well-known/openid-configuration"
        );
        assert_eq!(
            discovery_url("https://auth.acme.example/realms/main"),
            "https://auth.acme.example/realms/main/.well-known/openid-configuration"
        );
    }

    #[test]
    fn a_callback_counts_only_for_the_flow_whose_state_it_carries() {
        assert_eq!(
            code_from(&callback(Some("c"), Some("s"), None), "s").as_deref(),
            Ok("c")
        );
        assert!(code_from(&callback(Some("c"), Some("other"), None), "s")
            .unwrap_err()
            .contains("not the one"));
        assert!(code_from(&callback(Some("c"), None, None), "s").is_err());
        assert!(
            code_from(&callback(None, Some("s"), Some("access_denied")), "s")
                .unwrap_err()
                .contains("access_denied")
        );
        assert!(code_from(&callback(None, Some("s"), None), "s")
            .unwrap_err()
            .contains("without a sign-in"));
    }

    #[tokio::test]
    async fn a_callback_reaches_the_waiting_flow_with_its_state_and_no_other() {
        let sign_in = SignIn::new(Box::new(MemoryStore::default()));
        let waiting = sign_in.wait_for("s-1".into(), "https://id.acme.example/authorize?x".into());
        assert_eq!(
            sign_in.waiting_url().as_deref(),
            Some("https://id.acme.example/authorize?x")
        );

        assert!(
            !sign_in.deliver(callback(Some("c"), Some("s-2"), None)),
            "another flow's callback"
        );
        assert!(sign_in.deliver(callback(Some("c"), Some("s-1"), None)));
        assert_eq!(waiting.await.unwrap().code.as_deref(), Some("c"));
        assert!(
            !sign_in.deliver(callback(Some("c"), Some("s-1"), None)),
            "delivered once"
        );
        assert_eq!(sign_in.waiting_url(), None);
    }

    #[tokio::test]
    async fn cancelling_ends_the_wait() {
        let sign_in = SignIn::new(Box::new(MemoryStore::default()));
        let waiting = sign_in.wait_for("s-1".into(), "u".into());
        sign_in.cancel();
        assert!(waiting.await.is_err());
    }

    #[test]
    fn the_person_is_read_from_the_id_token() {
        let payload = URL_SAFE_NO_PAD.encode(r#"{"sub":"auth0|ada","email":"ada@acme.example","name":"Ada","picture":"https://p/ada.png"}"#);
        let person = person_of(Some(&format!("h.{payload}.s")));
        assert_eq!(person.sub, "auth0|ada");
        assert_eq!(person.email.as_deref(), Some("ada@acme.example"));
        assert_eq!(person.name.as_deref(), Some("Ada"));
        assert_eq!(person.picture.as_deref(), Some("https://p/ada.png"));
        assert_eq!(person_of(None), Person::default());
        assert_eq!(person_of(Some("not-a-jwt")), Person::default());
    }

    #[test]
    fn a_fresh_token_is_kept_in_memory_and_its_refresh_token_in_the_store() {
        let sign_in_state = SignIn::new(Box::new(MemoryStore::default()));
        let origin = "https://stigmer.acme.internal";
        let view = sign_in_state
            .keep(
                origin,
                &sign_in(),
                TokenResponse {
                    access_token: "access-1".into(),
                    refresh_token: Some("refresh-1".into()),
                    id_token: None,
                    expires_in: Some(3600),
                },
                None,
            )
            .unwrap();
        assert_eq!(view.access_token, "access-1");
        assert!(view.expires_at > now_ms() + 3_500_000);
        assert!(
            !view.kept_between_launches,
            "the memory store forgets at quit"
        );
        assert_eq!(sign_in_state.live_view(origin), Some(view));
        let stored = sign_in_state.store.load(origin).unwrap().unwrap();
        assert_eq!(stored.refresh_token, "refresh-1");
        assert_eq!(stored.client_id, "native-1");

        // A refresh that sends no new refresh token keeps the old one.
        sign_in_state
            .keep(
                origin,
                &sign_in(),
                TokenResponse {
                    access_token: "access-2".into(),
                    refresh_token: None,
                    id_token: None,
                    expires_in: Some(30),
                },
                Some(&stored),
            )
            .unwrap();
        assert_eq!(
            sign_in_state
                .store
                .load(origin)
                .unwrap()
                .unwrap()
                .refresh_token,
            "refresh-1"
        );
        assert_eq!(
            sign_in_state.live_view(origin),
            None,
            "a token within a minute of expiry is not handed out"
        );

        sign_in_state.forget(origin).unwrap();
        assert_eq!(sign_in_state.store.load(origin).unwrap(), None);
    }

    #[test]
    fn a_provider_on_the_server_s_own_site_is_recognised() {
        for (server, issuer) in [
            ("https://api.stigmer.ai", "https://id.stigmer.ai/"),
            (
                "https://api.dev.stigmer.ai",
                "https://id.preprod.stigmer.ai/",
            ),
            ("https://stigmer.acme.co.uk", "https://id.acme.co.uk/"),
            ("http://127.0.0.1:7801", "http://127.0.0.1:7299"),
            ("http://localhost:7801", "http://127.0.0.1:7299/"),
        ] {
            assert!(
                provider_on_servers_site(server, issuer),
                "{issuer} is on {server}'s site"
            );
        }
    }

    #[test]
    fn a_provider_on_another_site_is_recognised() {
        for (server, issuer) in [
            // A server someone was talked into choosing, borrowing a
            // company's sign-in to collect its tokens.
            ("https://evil.example", "https://id.acme.com/"),
            // A company's own server and its hosted provider: legitimate,
            // but the person is asked.
            ("https://stigmer.acme.com", "https://acme.okta.com/"),
            (
                "https://stigmer.acme.com",
                "https://login.microsoftonline.com/t/v2.0",
            ),
            // Two names under one public suffix belong to different owners.
            ("https://evil.github.io", "https://victim.github.io/"),
            ("https://10.0.0.5", "https://10.0.0.6/"),
            ("https://stigmer.acme.com", "not a url"),
        ] {
            assert!(
                !provider_on_servers_site(server, issuer),
                "{issuer} is not on {server}'s site"
            );
        }
    }

    #[test]
    fn a_provider_on_another_site_signs_in_only_once_the_person_chose_it() {
        let borrowed = NativeSignIn {
            issuer: "https://id.acme.com/".into(),
            audience: "https://api.acme.com".into(),
            client_id: "acme-desktop".into(),
        };
        let refused = admit_provider("https://evil.example", &borrowed, false).unwrap_err();
        assert!(
            refused.contains("evil.example") && refused.contains("id.acme.com"),
            "{refused}"
        );
        assert_eq!(
            admit_provider("https://evil.example", &borrowed, true),
            Ok(())
        );
        let own = NativeSignIn {
            issuer: "https://id.stigmer.ai/".into(),
            ..borrowed
        };
        assert_eq!(
            admit_provider("https://api.stigmer.ai", &own, false),
            Ok(())
        );
    }

    fn fresh_tokens() -> TokenResponse {
        TokenResponse {
            access_token: "access-1".into(),
            refresh_token: Some("refresh-1".into()),
            id_token: None,
            expires_in: Some(3600),
        }
    }

    #[tokio::test]
    async fn a_session_from_a_provider_the_server_no_longer_announces_is_dropped() {
        let origin = "https://stigmer.acme.internal";
        let moved = [
            NativeSignIn {
                issuer: "https://id.new.example/".into(),
                ..sign_in()
            },
            NativeSignIn {
                audience: "https://api.new.example".into(),
                ..sign_in()
            },
            NativeSignIn {
                client_id: "native-2".into(),
                ..sign_in()
            },
        ];
        for announced in moved {
            let state = SignIn::new(Box::new(MemoryStore::default()));
            state
                .keep(origin, &sign_in(), fresh_tokens(), None)
                .unwrap();
            assert_eq!(
                state.session_for(origin, &announced).await,
                Ok(None),
                "a session from {:?} was adopted under {announced:?}",
                sign_in()
            );
            assert_eq!(state.live_view(origin), None);
            assert_eq!(state.store.load(origin).unwrap(), None);
        }

        // The provider it was signed in through is still the one announced.
        let state = SignIn::new(Box::new(MemoryStore::default()));
        let view = state
            .keep(origin, &sign_in(), fresh_tokens(), None)
            .unwrap();
        assert_eq!(state.session_for(origin, &sign_in()).await, Ok(Some(view)));
    }

    #[test]
    fn only_a_provider_that_rejects_the_grant_ends_the_session() {
        use reqwest::StatusCode;
        let refused = |status: StatusCode, body: &str| {
            matches!(token_failure(status, body), Some(TokenFailure::Refused(_)))
        };
        assert!(refused(
            StatusCode::BAD_REQUEST,
            r#"{"error":"invalid_grant"}"#
        ));
        assert!(refused(
            StatusCode::UNAUTHORIZED,
            r#"{"error":"invalid_client"}"#
        ));
        // Busy, slow or down: keep the session and try again later.
        for status in [
            StatusCode::TOO_MANY_REQUESTS,
            StatusCode::REQUEST_TIMEOUT,
            StatusCode::INTERNAL_SERVER_ERROR,
            StatusCode::SERVICE_UNAVAILABLE,
        ] {
            assert!(
                matches!(
                    token_failure(status, ""),
                    Some(TokenFailure::Unreachable(_))
                ),
                "{status} signed the person out"
            );
        }
        assert!(token_failure(StatusCode::OK, "{}").is_none());
    }
}
