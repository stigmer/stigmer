/**
 * Console URL builders for the session launcher.
 *
 * The launcher (`/`) reads `?agent=org/slug` and `?plugin=org/slug` once,
 * and `?agent=org/slug&example=<id>&with=sample|own` (a launch from the
 * agent page's "Make it yours" tab) on each arrival, then cleans the URL;
 * these builders are the one place those parameters are spelled, so a
 * detail page's "Start session", "Start a chat" or "Make it yours" acts and
 * the launcher agree.
 */

/**
 * Build a Console URL that opens the new-session screen with a specific
 * agent pre-selected. The conversation starts on the agent itself; the
 * server pins its current version. This powers the "Start session"
 * action on the Agent detail page.
 *
 * @example
 * ```tsx
 * router.push(getAgentSessionUrl("acme", "variance-reporter"));
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

/**
 * Build a Console URL that opens the new-session screen on an agent for a
 * run on its example's sample (`mode: "sample"`: the sample attached and
 * the first message written) or on a file of the person's own
 * (`mode: "own"`: the message for their own file written, the attach
 * invited). Every arrival is a fresh composer, even into a launcher that
 * stayed mounted. This powers the agent page's "Make it yours" tab.
 *
 * @example
 * ```tsx
 * router.push(getAgentLaunchUrl("acme", "variance-reporter", { example: "variance-report", mode: "own" }));
 * ```
 */
export function getAgentLaunchUrl(
  org: string,
  slug: string,
  launch: { readonly example: string | undefined; readonly mode: "sample" | "own" },
): string {
  const params = new URLSearchParams({ agent: `${org}/${slug}` });
  if (launch.example) params.set("example", launch.example);
  params.set("with", launch.mode);
  return `/?${params.toString()}`;
}
