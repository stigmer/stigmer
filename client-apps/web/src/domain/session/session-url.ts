/**
 * Console URL builders for the session launcher.
 *
 * The launcher (`/`) reads `?agent=org/slug` once, then cleans the URL;
 * this builder is the one place that parameter is spelled, so a detail
 * page's "Start session" action and the launcher agree.
 */

/**
 * Build a Console URL that opens the new-session screen with a specific
 * agent pre-selected. The conversation starts on the agent itself; the
 * server pins its current version. This powers the "Start session"
 * actions on the Agent and Plugin detail pages.
 *
 * @example
 * ```tsx
 * router.push(getAgentSessionUrl("acme", "code-reviewer"));
 * ```
 */
export function getAgentSessionUrl(org: string, slug: string): string {
  return `/?agent=${encodeURIComponent(`${org}/${slug}`)}`;
}
