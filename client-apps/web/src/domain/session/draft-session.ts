/**
 * Console-specific draft session URL builders.
 *
 * The core draft types, CREATOR_AGENTS constant, and parsing functions
 * now live in `@stigmer/react` (SDK). This file re-exports them for
 * backward compatibility and provides Console-specific URL builders.
 */
export type { DraftResourceType, DraftParams } from "@stigmer/react";
export { CREATOR_AGENTS, parseDraftType, parseDraftParams } from "@stigmer/react";

/**
 * Build a Console URL that navigates to the SessionLauncher with the
 * specified system agent pre-selected.
 *
 * @example
 * ```tsx
 * import Link from "next/link";
 * import { getDraftSessionUrl } from "@/domain/session/draft-session";
 *
 * <Link href={getDraftSessionUrl("agent")}>Add Agent</Link>
 * ```
 */
export function getDraftSessionUrl(resourceType: string): string {
  return `/?draft=${resourceType}`;
}

/**
 * Build a Console URL that opens an edit session for an existing resource.
 *
 * @example
 * ```tsx
 * import Link from "next/link";
 * import { getEditSessionUrl } from "@/domain/session/draft-session";
 *
 * <Link href={getEditSessionUrl("agent", "acme", "my-agent")}>Edit</Link>
 * ```
 */
export function getEditSessionUrl(
  resourceType: string,
  org: string,
  slug: string,
): string {
  return `/?draft=${resourceType}&editOrg=${encodeURIComponent(org)}&editSlug=${encodeURIComponent(slug)}`;
}

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
