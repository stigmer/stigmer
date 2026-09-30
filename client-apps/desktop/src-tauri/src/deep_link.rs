//! Where a `stigmer://` deep link goes.
//!
//! The OS hands the app every `stigmer://` URL it opens: the Auth0 sign-in
//! callback, the GitHub callback the web console relays for a desktop-started
//! sign-in, and the billing return. [`route`] decides which app event a URL
//! becomes, as a pure function of the URL, so the routing is tested without a
//! running app; `lib.rs` only emits what it returns and brings the window
//! forward. Any other `stigmer://` URL is ignored.

use crate::auth::{param, AuthCallbackPayload};
use serde::Serialize;

/// What `stigmer://billing/return` carries back from Stripe by way of the
/// web console's desktop bridge (`/desktop/billing`): the outcome only, so
/// the billing page can reopen the plan a saved card was for. The state
/// itself is read from the server.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct BillingReturnPayload {
    pub setup: Option<String>,
    pub plan: Option<String>,
    pub checkout: Option<String>,
}

/// The app event a deep link becomes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum DeepLinkEvent {
    /// `stigmer://auth/callback`: the Auth0 sign-in's code, state or error.
    AuthCallback(AuthCallbackPayload),
    /// `stigmer://github/callback`: the GitHub authorization's code, state or error.
    GitHubCallback(AuthCallbackPayload),
    /// `stigmer://billing/return`: the outcome of a Stripe checkout or card setup.
    BillingReturn(BillingReturnPayload),
}

impl DeepLinkEvent {
    /// The event name the web layer listens for.
    pub(crate) fn name(&self) -> &'static str {
        match self {
            DeepLinkEvent::AuthCallback(_) => "auth-callback",
            DeepLinkEvent::GitHubCallback(_) => "github-callback",
            DeepLinkEvent::BillingReturn(_) => "billing-return",
        }
    }
}

/// The event `url` becomes, or `None` for a URL the app does not serve. The
/// scheme, host and path must all match exactly; a query parameter that
/// repeats is read at its first occurrence.
pub(crate) fn route(url: &url::Url) -> Option<DeepLinkEvent> {
    if url.scheme() != "stigmer" {
        return None;
    }
    match (url.host_str(), url.path()) {
        (Some("auth"), "/callback") => Some(DeepLinkEvent::AuthCallback(callback_payload(url))),
        (Some("github"), "/callback") => Some(DeepLinkEvent::GitHubCallback(callback_payload(url))),
        (Some("billing"), "/return") => Some(DeepLinkEvent::BillingReturn(BillingReturnPayload {
            setup: param(url, "setup"),
            plan: param(url, "plan"),
            checkout: param(url, "checkout"),
        })),
        _ => None,
    }
}

fn callback_payload(url: &url::Url) -> AuthCallbackPayload {
    AuthCallbackPayload {
        code: param(url, "code"),
        state: param(url, "state"),
        error: param(url, "error"),
        error_description: param(url, "error_description"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn routed(raw: &str) -> Option<DeepLinkEvent> {
        route(&url::Url::parse(raw).expect("test URL parses"))
    }

    fn callback(
        code: Option<&str>,
        state: Option<&str>,
        error: Option<&str>,
        error_description: Option<&str>,
    ) -> AuthCallbackPayload {
        AuthCallbackPayload {
            code: code.map(str::to_owned),
            state: state.map(str::to_owned),
            error: error.map(str::to_owned),
            error_description: error_description.map(str::to_owned),
        }
    }

    #[test]
    fn the_sign_in_callback_carries_its_code_and_state() {
        assert_eq!(
            routed("stigmer://auth/callback?code=c-1&state=s-1"),
            Some(DeepLinkEvent::AuthCallback(callback(
                Some("c-1"),
                Some("s-1"),
                None,
                None
            )))
        );
    }

    #[test]
    fn the_sign_in_callback_carries_the_identity_providers_error_decoded() {
        assert_eq!(
            routed("stigmer://auth/callback?state=s&error=access_denied&error_description=The%20user%20said%20no"),
            Some(DeepLinkEvent::AuthCallback(callback(
                None,
                Some("s"),
                Some("access_denied"),
                Some("The user said no"),
            )))
        );
    }

    #[test]
    fn the_github_callback_is_its_own_event() {
        assert_eq!(
            routed("stigmer://github/callback?code=gh&state=st"),
            Some(DeepLinkEvent::GitHubCallback(callback(
                Some("gh"),
                Some("st"),
                None,
                None
            )))
        );
    }

    #[test]
    fn the_billing_return_carries_the_outcome_only() {
        assert_eq!(
            routed("stigmer://billing/return?setup=succeeded&plan=pro&checkout=cs_1&code=ignored"),
            Some(DeepLinkEvent::BillingReturn(BillingReturnPayload {
                setup: Some("succeeded".into()),
                plan: Some("pro".into()),
                checkout: Some("cs_1".into()),
            }))
        );
    }

    #[test]
    fn a_callback_with_no_query_carries_nothing() {
        assert_eq!(
            routed("stigmer://auth/callback"),
            Some(DeepLinkEvent::AuthCallback(callback(
                None, None, None, None
            )))
        );
    }

    #[test]
    fn a_repeated_parameter_is_read_at_its_first_occurrence() {
        assert_eq!(
            routed("stigmer://auth/callback?code=first&state=s&code=second"),
            Some(DeepLinkEvent::AuthCallback(callback(
                Some("first"),
                Some("s"),
                None,
                None
            )))
        );
    }

    #[test]
    fn an_encoded_ampersand_stays_inside_its_value() {
        assert_eq!(
            routed("stigmer://github/callback?code=a%26state%3Dforged&state=real"),
            Some(DeepLinkEvent::GitHubCallback(callback(
                Some("a&state=forged"),
                Some("real"),
                None,
                None,
            )))
        );
    }

    #[test]
    fn urls_the_app_does_not_serve_are_ignored() {
        for raw in [
            "https://auth/callback?code=c&state=s",
            "stigmerx://auth/callback?code=c",
            "stigmer://auth/other?code=c",
            "stigmer://auth/callback/extra?code=c",
            "stigmer://evil/callback?code=c",
            "stigmer://billing/callback?setup=x",
            "stigmer://github/return?code=c",
        ] {
            assert_eq!(routed(raw), None, "{raw} must not route");
        }
    }

    #[test]
    fn each_event_has_the_name_the_web_layer_listens_for() {
        let payload = callback(None, None, None, None);
        assert_eq!(
            DeepLinkEvent::AuthCallback(payload.clone()).name(),
            "auth-callback"
        );
        assert_eq!(
            DeepLinkEvent::GitHubCallback(payload).name(),
            "github-callback"
        );
        let billing = BillingReturnPayload {
            setup: None,
            plan: None,
            checkout: None,
        };
        assert_eq!(
            DeepLinkEvent::BillingReturn(billing).name(),
            "billing-return"
        );
    }
}
