/**
 * Console URL builders for the session launcher.
 *
 * The launcher (`/`) reads `?agent=org/slug` and `?instance=id` once, then
 * cleans the URL; these builders are the one place those parameters are
 * spelled, so a detail page's "Start session" action and the launcher agree.
 */

/**
 * Build a Console URL that opens the new-session screen with a specific
 * agent pre-selected, optionally bound to a specific AgentInstance.
 *
 * When `instanceId` is provided, the session is created against that exact
 * configured deployment (its environment bindings are used and the
 * env-collection flow is skipped). This powers the "Start session" actions
 * on the Agent detail page.
 *
 * @example
 * ```tsx
 * router.push(getAgentSessionUrl("acme", "code-reviewer", "ain-123"));
 * ```
 */
export function getAgentSessionUrl(
  org: string,
  slug: string,
  instanceId?: string,
): string {
  const base = `/?agent=${encodeURIComponent(`${org}/${slug}`)}`;
  return instanceId
    ? `${base}&instance=${encodeURIComponent(instanceId)}`
    : base;
}
