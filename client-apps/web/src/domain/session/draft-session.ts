import type { ResourceRef } from "@stigmer/sdk";

/**
 * Resource types that can be created via a draft session.
 *
 * Each type maps to a Stigmer system agent that guides the user
 * through the creation flow in a conversational session.
 */
export type DraftResourceType = "agent" | "skill" | "mcp-server";

/**
 * Parsed draft session parameters from the URL.
 *
 * When `editRef` is present, the session is an edit session (modify an
 * existing resource). When absent, it's a create session (new resource).
 */
export interface DraftParams {
  /** The resource type being created or edited. */
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
 * import { getDraftSessionUrl } from "@/domain/session/draft-session";
 *
 * <Link href={getDraftSessionUrl("agent")}>Add Agent</Link>
 * // renders <a href="/?draft=agent">Add Agent</a>
 * ```
 */
export function getDraftSessionUrl(resourceType: DraftResourceType): string {
  return `/?draft=${resourceType}`;
}

/**
 * Build a Console URL that opens an edit session for an existing resource.
 *
 * The URL includes `editOrg` and `editSlug` params alongside the `draft`
 * param so `SessionLauncher` can fetch the resource, serialize it, and
 * attach it to the composer as an initial attachment.
 *
 * @example
 * ```tsx
 * import Link from "next/link";
 * import { getEditSessionUrl } from "@/domain/session/draft-session";
 *
 * <Link href={getEditSessionUrl("agent", "acme", "my-agent")}>Edit</Link>
 * // renders <a href="/?draft=agent&editOrg=acme&editSlug=my-agent">Edit</a>
 * ```
 */
export function getEditSessionUrl(
  resourceType: DraftResourceType,
  org: string,
  slug: string,
): string {
  return `/?draft=${resourceType}&editOrg=${encodeURIComponent(org)}&editSlug=${encodeURIComponent(slug)}`;
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

/**
 * Parse full draft session parameters from URL search params, including
 * optional edit-mode references.
 *
 * Returns `null` when no valid `draft` param is present. When `editOrg`
 * and `editSlug` are both present, the returned object includes an
 * `editRef` indicating this is an edit session rather than a create session.
 *
 * @example
 * ```ts
 * const params = parseDraftParams(searchParams);
 * if (params?.editRef) {
 *   // Edit mode: fetch existing resource and attach to composer
 * } else if (params) {
 *   // Create mode: pre-select the creator agent
 * }
 * ```
 */
export function parseDraftParams(
  searchParams: URLSearchParams,
): DraftParams | null {
  const draftType = parseDraftParam(searchParams);
  if (!draftType) return null;

  const editOrg = searchParams.get("editOrg");
  const editSlug = searchParams.get("editSlug");

  if (editOrg && editSlug) {
    return { draftType, editRef: { org: editOrg, slug: editSlug } };
  }

  return { draftType };
}
