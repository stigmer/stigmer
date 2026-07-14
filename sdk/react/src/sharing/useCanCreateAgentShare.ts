"use client";

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { useCheckPermission } from "../iam-policy/useCheckPermission.js";

/** Return value of {@link useCanCreateAgentShare}. */
export interface UseCanCreateAgentShareReturn {
  /** Whether the viewer may create a share of this agent in `shareOrg`. */
  readonly allowed: boolean;
  /**
   * The org that would own the new share — the viewer's org when set,
   * else the agent's own. The share's URL, billing, and credential
   * bindings all belong to this org.
   */
  readonly shareOrg: string;
  /** Whether creating in `shareOrg` would be a cross-org share (decision 013). */
  readonly isCrossOrg: boolean;
}

/**
 * Mirrors the server's AgentShare create bar so create affordances never
 * appear to a user whose create would be refused:
 *
 * - **Same-org** (`shareOrg` equals the agent's org): agent `can_edit` —
 *   the exact permission the create/apply handlers enforce on the
 *   referenced agent.
 * - **Cross-org** (decision 013 D2, two-sided): the agent must be
 *   `visibility_public` — the origin org's implicit consent (D1), and
 *   the client-side proxy for the `can_execute`-via-`allow_public` half
 *   of the bar — and the viewer must hold `can_create_agent_share` in
 *   their own org (admin-level: a public share spends that org's credits
 *   on the open internet). The org check uses the org slug as the
 *   resource id — an Organization's id equals its slug
 *   (ApiResourceMetadata.id).
 *
 * On the OSS edition {@link useCheckPermission} degrades to allowed
 * (no IAM service), matching the backend's documented no-op
 * authorization (decision 011 D4).
 *
 * Pass `null` for `agent` while it loads — `allowed` stays `false` so
 * no affordance flashes before the gate can be evaluated.
 *
 * @param agent      The agent to share, or `null` while loading.
 * @param viewerOrg  The viewer's active org. Empty/omitted means the
 *                   agent's own org (the same-org owner flow).
 */
export function useCanCreateAgentShare(
  agent: Agent | null,
  viewerOrg?: string,
): UseCanCreateAgentShareReturn {
  const agentId = agent?.metadata?.id ?? "";
  const agentOrg = agent?.metadata?.org ?? "";
  const shareOrg = viewerOrg || agentOrg;
  const isCrossOrg = shareOrg !== "" && shareOrg !== agentOrg;
  const isPublic =
    agent?.metadata?.visibility === ApiResourceVisibility.visibility_public;

  // Both permission checks are declared unconditionally (hook rules);
  // each skips its RPC (null resource) when its branch doesn't apply.
  const { allowed: canEditAgent } = useCheckPermission(
    !isCrossOrg && agentId ? { kind: "agent", id: agentId } : null,
    "can_edit",
  );
  const { allowed: canCreateInOrg } = useCheckPermission(
    isCrossOrg && isPublic ? { kind: "organization", id: shareOrg } : null,
    "can_create_agent_share",
  );

  const allowed =
    !!agent && (isCrossOrg ? isPublic && canCreateInOrg : canEditAgent);

  return { allowed, shareOrg, isCrossOrg };
}
