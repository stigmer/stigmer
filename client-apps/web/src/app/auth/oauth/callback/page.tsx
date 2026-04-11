"use client";

import { OAuthCallbackHandler } from "@stigmer/react";

/**
 * OAuth callback page for MCP server authentication.
 *
 * This route is the redirect target for OAuth authorization flows
 * initiated by `useMcpServerOAuthConnect`. The OAuth provider redirects
 * here with `code` and `state` query parameters after the user
 * authorizes access.
 *
 * The `OAuthCallbackHandler` component extracts the parameters, posts
 * them back to the opener window via `postMessage`, and closes the
 * popup. No Console-specific logic is needed — the SDK component
 * handles everything.
 *
 * The URL of this page must match the `STIGMER_OAUTH_REDIRECT_URI`
 * deployment configuration.
 */
export default function McpOAuthCallbackPage() {
  return <OAuthCallbackHandler className="min-h-screen" />;
}
