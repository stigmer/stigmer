"use client";

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { useCheckPermission } from "../iam-policy/useCheckPermission.js";

/** Return value of {@link useCanCreateAgentShare}. */
export interface UseCanCreateAgentShareReturn {
  /** Whether the viewer may create a share of this agent. */
  readonly allowed: boolean;
}

/**
 * Mirrors the server's AgentShare create bar so create affordances never
 * appear to a user whose create would be refused.
 *
 * A share lives in its agent's organization (to share another
 * organization's agent, install the plugin that carries it and share the
 * installed copy), and creating one asks two questions of that
 * organization, both of which the create handler enforces:
 *
 * - `can_edit` on the agent — the share is a channel to this agent.
 * - `can_create_agent_share` on the organization (admin by default) — a
 *   share spends the organization's credits with anyone on the internet,
 *   so it is an admin-level decision. The org check uses the org slug as
 *   the resource id — an Organization's id equals its slug
 *   (ApiResourceMetadata.id).
 *
 * A viewer from another organization looking at a platform-visible agent
 * needs no special case: both checks answer false for them, so the
 * affordance hides on permissions alone.
 *
 * On the open-source edition the answer follows the server's posture. A
 * server without sign-in has the permissive single-team authorizer and
 * answers allowed (decision 011 D4). A server with sign-in enforces the
 * same organization roles as the cloud, so `can_create_agent_share` is
 * the admin's and a member sees no share affordance.
 *
 * Pass `null` for `agent` while it loads — `allowed` stays `false` so
 * no affordance flashes before the gate can be evaluated.
 *
 * @param agent  The agent to share, or `null` while loading.
 */
export function useCanCreateAgentShare(
  agent: Agent | null,
): UseCanCreateAgentShareReturn {
  const agentId = agent?.metadata?.id ?? "";
  const agentOrg = agent?.metadata?.org ?? "";

  const { allowed: canEditAgent } = useCheckPermission(
    agentId ? { kind: "agent", id: agentId } : null,
    "can_edit",
  );
  const { allowed: canCreateInOrg } = useCheckPermission(
    agentOrg ? { kind: "organization", id: agentOrg } : null,
    "can_create_agent_share",
  );

  return { allowed: !!agent && canEditAgent && canCreateInOrg };
}
