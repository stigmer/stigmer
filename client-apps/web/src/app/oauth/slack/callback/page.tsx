"use client";

import { OAuthCallbackHandler } from "@stigmer/react";

/**
 * OAuth callback page for Slack channel installs.
 *
 * This route is the redirect target of the "Add to Slack" consent flow
 * initiated by `useConnectSlackChannel`. Slack redirects here with `code`
 * and `state` query parameters after the workspace admin approves the
 * install.
 *
 * The `OAuthCallbackHandler` component extracts the parameters, posts
 * them back to the opener window (postMessage + BroadcastChannel), and
 * closes the popup. No Console-specific logic is needed — the SDK
 * component handles everything.
 *
 * The URL of this page is pinned by the Slack app manifest's
 * `oauth_config.redirect_urls` ({{CONSOLE_ORIGIN}}/oauth/slack/callback).
 */
export default function SlackOAuthCallbackPage() {
  return <OAuthCallbackHandler className="min-h-screen" />;
}
