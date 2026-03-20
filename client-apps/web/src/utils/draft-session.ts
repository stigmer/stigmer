import type { ResourceRef } from "@stigmer/sdk";

/**
 * Resource types that can be created via a draft session.
 *
 * Each type maps to a Stigmer system agent that guides the user
 * through the creation flow in a conversational session.
 */
export type DraftResourceType = "agent" | "skill" | "mcp-server";

/**
 * System agents responsible for creating each resource type.
 *
 * Keys match {@link DraftResourceType}; values are {@link ResourceRef}
 * objects pointing to Stigmer's built-in creator agents.
 *
 * Used by `SessionLauncher` to resolve a draft query param into the
 * agent ref that should be pre-selected in the composer.
 */
export const CREATOR_AGENTS: Record<DraftResourceType, ResourceRef> = {
  agent: { org: "stigmer", slug: "agent-creator" },
  skill: { org: "stigmer", slug: "skill-creator" },
  "mcp-server": { org: "stigmer", slug: "mcp-server-creator" },
};

const VALID_TYPES = new Set<string>(Object.keys(CREATOR_AGENTS));

/**
 * Build a Console URL that navigates to the SessionLauncher with the
 * specified system agent pre-selected.
 *
 * @example
 * ```tsx
 * import Link from "next/link";
 * import { getDraftSessionUrl } from "@/utils/draft-session";
 *
 * <Link href={getDraftSessionUrl("agent")}>Create Agent</Link>
 * // renders <a href="/?draft=agent">Create Agent</a>
 * ```
 */
export function getDraftSessionUrl(resourceType: DraftResourceType): string {
  return `/?draft=${resourceType}`;
}

/**
 * Safely extract and validate a draft resource type from URL search params.
 *
 * Returns the validated {@link DraftResourceType} when the `draft` param
 * is present and recognized, or `null` otherwise. Consumers use the result
 * with {@link CREATOR_AGENTS} to obtain the corresponding agent ref.
 *
 * @example
 * ```ts
 * const draft = parseDraftParam(searchParams);
 * if (draft) {
 *   const agentRef = CREATOR_AGENTS[draft];
 *   // pre-select agentRef in the composer
 * }
 * ```
 */
export function parseDraftParam(
  searchParams: URLSearchParams,
): DraftResourceType | null {
  const value = searchParams.get("draft");
  if (value !== null && VALID_TYPES.has(value)) {
    return value as DraftResourceType;
  }
  return null;
}
