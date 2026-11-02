//! Where a sign-in is kept between launches: the system keychain.
//!
//! The refresh token is the long-lived credential, so it lives where the
//! system keeps secrets (the macOS Keychain, the Windows Credential Manager,
//! the Secret Service on Linux), one entry per server origin, and never in
//! the webview: a script in the page can read web storage, and the keychain
//! ties the entry to this app. Each server keeps its own entry, so switching
//! back to a server finds the person still signed in.
//!
//! What an entry holds ([`StoredSession`]): the refresh token, the identity
//! provider and client it belongs to (a refresh goes back to the same one),
//! and the person's display claims, so the app can show who is signed in
//! before its first refresh. Never the access token, which lives in memory
//! (`oidc.rs`) and expires within the hour.
//!
//! Two places keep sessions in memory only, and say so:
//! - a debug build. A rebuilt binary is a different app to the keychain,
//!   which would then ask for the login password on every launch and stop a
//!   walk an agent drives; signing in again against a local issuer is free;
//! - a Linux desktop with no Secret Service running. The app works, and
//!   asks the person to sign in at each launch.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

/// The keychain service every entry is filed under: the app's bundle id.
pub(crate) const KEYCHAIN_SERVICE: &str = "ai.stigmer.desktop";

/// The display claims an ID token carries about the person.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Person {
    pub sub: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub picture: Option<String>,
}

/// What one server's entry holds.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSession {
    pub refresh_token: String,
    pub issuer: String,
    pub audience: String,
    pub client_id: String,
    pub person: Person,
}

/// A place sessions are kept, keyed by server origin.
pub trait SessionStore: Send + Sync {
    fn load(&self, origin: &str) -> Result<Option<StoredSession>, String>;
    fn save(&self, origin: &str, session: &StoredSession) -> Result<(), String>;
    fn delete(&self, origin: &str) -> Result<(), String>;
    /// Whether sessions outlive the app; false for the memory store.
    fn persists(&self) -> bool;
}

/// Sessions kept for this run only.
#[derive(Default)]
pub struct MemoryStore(Mutex<HashMap<String, StoredSession>>);

impl SessionStore for MemoryStore {
    fn load(&self, origin: &str) -> Result<Option<StoredSession>, String> {
        Ok(self.0.lock().map_err(|e| e.to_string())?.get(origin).cloned())
    }
    fn save(&self, origin: &str, session: &StoredSession) -> Result<(), String> {
        self.0
            .lock()
            .map_err(|e| e.to_string())?
            .insert(origin.to_string(), session.clone());
        Ok(())
    }
    fn delete(&self, origin: &str) -> Result<(), String> {
        self.0.lock().map_err(|e| e.to_string())?.remove(origin);
        Ok(())
    }
    fn persists(&self) -> bool {
        false
    }
}

/// Sessions kept in the system keychain, one entry per server origin.
pub struct KeychainStore {
    service: String,
}

impl KeychainStore {
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }

    fn entry(&self, origin: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(&self.service, origin).map_err(keychain_error)
    }
}

fn keychain_error(error: keyring::Error) -> String {
    format!("The system keychain refused the app: {error}")
}

impl SessionStore for KeychainStore {
    fn load(&self, origin: &str) -> Result<Option<StoredSession>, String> {
        match self.entry(origin)?.get_password() {
            Ok(text) => Ok(serde_json::from_str(&text).ok()),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(keychain_error(error)),
        }
    }
    fn save(&self, origin: &str, session: &StoredSession) -> Result<(), String> {
        let text = serde_json::to_string(session).map_err(|e| e.to_string())?;
        self.entry(origin)?.set_password(&text).map_err(keychain_error)
    }
    fn delete(&self, origin: &str) -> Result<(), String> {
        match self.entry(origin)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(keychain_error(error)),
        }
    }
    fn persists(&self) -> bool {
        true
    }
}

/// Whether the system keychain answers at all: a Linux desktop with no
/// Secret Service fails here, before any entry is touched.
fn keychain_answers(service: &str) -> bool {
    match keyring::Entry::new(service, "stigmer-desktop-probe") {
        Ok(entry) => matches!(entry.get_password(), Ok(_) | Err(keyring::Error::NoEntry)),
        Err(_) => false,
    }
}

/// The store this build uses: memory in a debug build, the keychain in a
/// release build when it answers, memory with a notice when it does not.
pub fn for_this_build() -> Box<dyn SessionStore> {
    if cfg!(debug_assertions) {
        return Box::new(MemoryStore::default());
    }
    if keychain_answers(KEYCHAIN_SERVICE) {
        return Box::new(KeychainStore::new(KEYCHAIN_SERVICE));
    }
    eprintln!(
        "stigmer: the system keychain does not answer (no Secret Service on this desktop?); sign-in lasts until the app quits"
    );
    Box::new(MemoryStore::default())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(refresh: &str) -> StoredSession {
        StoredSession {
            refresh_token: refresh.into(),
            issuer: "https://id.acme.example/".into(),
            audience: "https://api.acme.example".into(),
            client_id: "native-1".into(),
            person: Person {
                sub: "auth0|ada".into(),
                email: Some("ada@acme.example".into()),
                name: Some("Ada".into()),
                picture: None,
            },
        }
    }

    /// Every store keeps one session per server origin and forgets on delete.
    fn holds_one_session_per_server(store: &dyn SessionStore) {
        let cloud = "https://api.stigmer.ai";
        let acme = "https://stigmer.acme.internal";
        assert_eq!(store.load(cloud).unwrap(), None);

        store.save(cloud, &session("refresh-cloud")).unwrap();
        store.save(acme, &session("refresh-acme")).unwrap();
        assert_eq!(store.load(cloud).unwrap(), Some(session("refresh-cloud")));
        assert_eq!(store.load(acme).unwrap(), Some(session("refresh-acme")));

        store.save(cloud, &session("refresh-cloud-2")).unwrap();
        assert_eq!(store.load(cloud).unwrap(), Some(session("refresh-cloud-2")));

        store.delete(cloud).unwrap();
        assert_eq!(store.load(cloud).unwrap(), None);
        assert_eq!(store.load(acme).unwrap(), Some(session("refresh-acme")));
        store.delete(cloud).unwrap();
    }

    #[test]
    fn the_memory_store_keeps_one_session_per_server_for_this_run() {
        let store = MemoryStore::default();
        holds_one_session_per_server(&store);
        assert!(!store.persists());
    }

    /// A stand-in for the system keychain: one shared map, keyed by
    /// service and account, the way the real stores file entries. keyring's
    /// own mock keeps a value on each `Entry` it builds, so a store that opens
    /// its entry per call (as the real one must) could not read back.
    #[derive(Default, Clone)]
    struct SharedKeychain(std::sync::Arc<Mutex<HashMap<(String, String), Vec<u8>>>>);

    struct SharedEntry {
        keychain: SharedKeychain,
        key: (String, String),
    }

    impl keyring::credential::CredentialApi for SharedEntry {
        fn set_secret(&self, secret: &[u8]) -> keyring::Result<()> {
            self.keychain.0.lock().unwrap().insert(self.key.clone(), secret.to_vec());
            Ok(())
        }
        fn get_secret(&self) -> keyring::Result<Vec<u8>> {
            self.keychain.0.lock().unwrap().get(&self.key).cloned().ok_or(keyring::Error::NoEntry)
        }
        fn delete_credential(&self) -> keyring::Result<()> {
            self.keychain.0.lock().unwrap().remove(&self.key).map(|_| ()).ok_or(keyring::Error::NoEntry)
        }
        fn as_any(&self) -> &dyn std::any::Any {
            self
        }
    }

    impl keyring::credential::CredentialBuilderApi for SharedKeychain {
        fn build(
            &self,
            _target: Option<&str>,
            service: &str,
            user: &str,
        ) -> keyring::Result<Box<keyring::credential::Credential>> {
            Ok(Box::new(SharedEntry {
                keychain: self.clone(),
                key: (service.to_string(), user.to_string()),
            }))
        }
        fn as_any(&self) -> &dyn std::any::Any {
            self
        }
    }

    #[test]
    fn the_keychain_store_keeps_one_session_per_server_in_the_keychain() {
        let keychain = SharedKeychain::default();
        keyring::set_default_credential_builder(Box::new(keychain.clone()));
        let store = KeychainStore::new("ai.stigmer.desktop.test");
        holds_one_session_per_server(&store);
        assert!(store.persists());

        // Each server's entry is filed under the app's service and the
        // server's origin, as JSON with the refresh token.
        store.save("https://api.stigmer.ai", &session("refresh-filed")).unwrap();
        let filed = keychain
            .0
            .lock()
            .unwrap()
            .get(&("ai.stigmer.desktop.test".to_string(), "https://api.stigmer.ai".to_string()))
            .cloned()
            .unwrap();
        let written: StoredSession = serde_json::from_slice(&filed).unwrap();
        assert_eq!(written, session("refresh-filed"));

        // An entry the store cannot read is no session, never a crash.
        keychain.0.lock().unwrap().insert(
            ("ai.stigmer.desktop.test".to_string(), "https://garbled.example".to_string()),
            b"not json".to_vec(),
        );
        assert_eq!(store.load("https://garbled.example").unwrap(), None);
    }

    #[test]
    fn an_entry_is_json_with_the_refresh_token_and_never_an_access_token() {
        let text = serde_json::to_string(&session("refresh-1")).unwrap();
        assert!(text.contains("\"refreshToken\":\"refresh-1\""));
        assert!(!text.to_lowercase().contains("access"));
    }
}
