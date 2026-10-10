/**
 * Console URL builders for the session launcher.
 *
 * The launcher (`/`) reads `?agent=org/slug` and `?plugin=org/slug` once,
 * then cleans the URL; these builders are the one place those parameters
 * are spelled, so a detail page's "Start session" or "Start a chat" action
 * and the launcher agree.
 */

/**
 * Build a Console URL that opens the new-session screen with a specific
 * agent pre-selected. The conversation starts on the agent itself; the
 * server pins its current version. This powers the "Start session"
 * action on the Agent detail page.
 *
 * @example
 * ```tsx
 * router.push(getAgentSessionUrl("acme", "code-reviewer"));
 * ```
 */
export function getAgentSessionUrl(org: string, slug: string): string {
  return `/?agent=${encodeURIComponent(`${org}/${slug}`)}`;
}

/**
 * Build a Console URL that opens the new-session screen for a chat with
 * the assistant that uses a plugin: the conversation lists the plugin and
 * runs no agent. This powers "Start a chat" on the Plugin detail page.
 *
 * @example
 * ```tsx
 * router.push(getPluginChatUrl("acme", "linear"));
 * ```
 */
export function getPluginChatUrl(org: string, slug: string): string {
  return `/?plugin=${encodeURIComponent(`${org}/${slug}`)}`;
}
