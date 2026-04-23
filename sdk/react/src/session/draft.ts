import type { ResourceRef } from "@stigmer/sdk";

/**
 * Resource types that can be created or edited via a draft session.
 *
 * Each type maps to a Stigmer system agent that guides the user
 * through the creation/editing flow in a conversational session.
 */
export type DraftResourceType = "agent" | "skill" | "mcp-server";

/**
 * Parsed draft session parameters.
 *
 * When `editRef` is present, the session is an edit session (modify an
 * existing resource). When absent, it's a create session (new resource).
 */
export interface DraftParams {
  readonly draftType: DraftResourceType;
  /**
   * When present, identifies the existing resource to edit.
   * Absent for create-mode sessions.
   */
  readonly editRef?: { readonly org: string; readonly slug: string };
}

/**
 * System agents responsible for creating each resource type.
 *
 * Keys match {@link DraftResourceType}; values are {@link ResourceRef}
 * objects pointing to Stigmer's built-in creator agents.
 */
export const CREATOR_AGENTS: Record<DraftResourceType, ResourceRef> = {
  agent: { org: "stigmer", slug: "agent-creator" },
  skill: { org: "stigmer", slug: "skill-creator" },
  "mcp-server": { org: "stigmer", slug: "mcp-server-creator" },
};

const VALID_TYPES = new Set<string>(Object.keys(CREATOR_AGENTS));

/**
 * Validate a string as a recognized {@link DraftResourceType}.
 *
 * Returns the validated type or `null` if unrecognized.
 */
export function parseDraftType(value: string | null): DraftResourceType | null {
  if (value !== null && VALID_TYPES.has(value)) {
    return value as DraftResourceType;
  }
  return null;
}

/**
 * Parse draft session parameters from standard `URLSearchParams`.
 *
 * Returns `null` when no valid `draft` param is present. When `editOrg`
 * and `editSlug` are both present, the returned object includes an
 * `editRef` indicating this is an edit session rather than a create session.
 *
 * Works identically with Next.js `useSearchParams()` or react-router's
 * `useSearchParams()` — both return standard `URLSearchParams`.
 */
export function parseDraftParams(
  searchParams: URLSearchParams,
): DraftParams | null {
  const draftType = parseDraftType(searchParams.get("draft"));
  if (!draftType) return null;

  const editOrg = searchParams.get("editOrg");
  const editSlug = searchParams.get("editSlug");

  if (editOrg && editSlug) {
    return { draftType, editRef: { org: editOrg, slug: editSlug } };
  }

  return { draftType };
}
