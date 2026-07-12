/**
 * Agent-sharing helpers — the single source of truth for the hosted chat
 * URL shape, the embed snippet, and client-side `allowed_origins`
 * validation. Framework-free by design: consumed by the web console and
 * desktop app (via `@stigmer/react`), the `stigmer` CLI, and any platform
 * builder that wants to construct share links or embed snippets itself.
 *
 * The canonical URL shape is `<app-origin>/chat/<org>/<slug>` (a T01
 * design decision), and `embed.js` is served from the root of that same
 * app origin (T04). Callers supply the origin — resolving it is a host
 * concern (the console knows its `appUrl`, the CLI resolves it from the
 * backend type) — while the path and snippet shapes live here so every
 * surface emits byte-identical output.
 */

/** Maximum number of allowed origins (proto: `repeated.max_items = 32`). */
export const MAX_ALLOWED_ORIGINS = 32;

/**
 * Exact web origin: scheme://host[:port] — no path, query, fragment, or
 * trailing slash. Mirrors the CEL expression `allowed_origins.format` on
 * `AgentSharing` (`apis/ai/stigmer/agentic/agent/v1/spec.proto`).
 *
 * The proto is the source of truth — if the CEL expression changes, this
 * pattern must change with it. Mirroring it client-side gives immediate
 * feedback instead of a round-trip rejection.
 */
const ORIGIN_PATTERN =
  /^https?:\/\/[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*(:[0-9]{1,5})?$/;

/**
 * Validate a single `allowed_origins` entry.
 *
 * Returns `null` when valid, or a user-facing message explaining what
 * to fix (DD-006: errors state what happened and what to do).
 */
export function validateOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Enter an origin, like https://example.com";
  if (!ORIGIN_PATTERN.test(trimmed)) {
    return "Must be an exact web origin like https://example.com — no path, query, or trailing slash";
  }
  return null;
}

/**
 * Query parameter carrying the share-link token on a locked link:
 * `/chat/<org>/<slug>?k=<token>`. Short by design — the token rides every
 * copied link, and `k` (for "key") is the platform's one-character
 * convention, mirrored by the hosted page and the embed widget.
 */
export const LINK_TOKEN_PARAM = "k";

/**
 * The hosted chat page path for a shared agent: `/chat/<org>/<slug>`,
 * plus `?k=<token>` when the share link is locked with a rotatable token
 * (`agent.status.shareLinkToken`).
 *
 * Useful on its own when the caller renders relative to the current
 * origin (e.g. a host that never configured an absolute app URL).
 */
export function chatPath(org: string, slug: string, linkToken?: string): string {
  const path = `/chat/${org}/${slug}`;
  return linkToken
    ? `${path}?${LINK_TOKEN_PARAM}=${encodeURIComponent(linkToken)}`
    : path;
}

/**
 * The absolute hosted chat URL for a shared agent:
 * `<appOrigin>/chat/<org>/<slug>[?k=<token>]`.
 *
 * A trailing slash on `appOrigin` is tolerated so callers can pass
 * user-configured values verbatim. An empty `appOrigin` degrades to the
 * relative {@link chatPath} — the same graceful fallback a host without a
 * configured public origin gets in the share dialog.
 */
export function buildChatUrl(
  appOrigin: string,
  org: string,
  slug: string,
  linkToken?: string,
): string {
  return stripTrailingSlash(appOrigin) + chatPath(org, slug, linkToken);
}

/**
 * Append the share-link token to an already-built chat URL.
 *
 * For hosts that construct the base URL through their own callback (the
 * share dialog's `buildShareUrl` prop) rather than {@link buildChatUrl}.
 * A `null`/empty token returns the URL unchanged, so callers can pass
 * `agent.status?.shareLinkToken` straight through. Emits the identical
 * `?k=` shape as {@link chatPath} — one URL grammar across every surface.
 */
export function appendLinkToken(url: string, linkToken: string | null | undefined): string {
  if (!linkToken) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${LINK_TOKEN_PARAM}=${encodeURIComponent(linkToken)}`;
}

/**
 * The embed loader URL: `embed.js` lives at the root of the app origin
 * (the loader derives the chat-page origin from its own script URL, so
 * the two must share an origin). An empty `appOrigin` degrades to the
 * relative `/embed.js`.
 */
export function buildEmbedLoaderUrl(appOrigin: string): string {
  return `${stripTrailingSlash(appOrigin)}/embed.js`;
}

/**
 * The two-line embed snippet an owner pastes into any website: the
 * loader script plus the `<stigmer-agent>` element where the widget
 * renders. A locked share link adds the `token` attribute, which the
 * widget forwards as `?k=` on its iframe URL. Every surface (share
 * dialog, CLI, docs) emits exactly this.
 */
export function buildEmbedSnippet(
  appOrigin: string,
  org: string,
  slug: string,
  linkToken?: string,
): string {
  const tokenAttribute = linkToken ? ` token="${linkToken}"` : "";
  return [
    `<script src="${buildEmbedLoaderUrl(appOrigin)}" async></script>`,
    `<stigmer-agent org="${org}" agent="${slug}"${tokenAttribute}></stigmer-agent>`,
  ].join("\n");
}

function stripTrailingSlash(origin: string): string {
  return origin.endsWith("/") ? origin.slice(0, -1) : origin;
}
