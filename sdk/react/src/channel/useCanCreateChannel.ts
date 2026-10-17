"use client";

import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { useCheckPermission } from "../grant/useCheckPermission.js";

/** Return value of {@link useCanCreateChannel}. */
export interface UseCanCreateChannelReturn {
  /** Whether the viewer may create a channel of this agent (a chat link, a Slack workspace, a WhatsApp number). */
  readonly allowed: boolean;
}

/**
 * Mirrors the server's Channel create bar so create affordances never
 * appear to a user whose create would be refused. One bar for every
 * type: the Channels tab asks it for a chat link, Slack and WhatsApp
 * alike (through {@link useAddChannelOptions}).
 *
 * A channel lives in its agent's organization (to share another
 * organization's agent, install the plugin that carries it and share the
 * installed copy), and creating one asks two questions of that
 * organization, both of which the create handler enforces:
 *
 * - `can_manage_audience` on the agent — a channel puts the agent in front
 *   of a wider audience, so it is the owner's decision; an editor, who may
 *   change the definition, may not publish it.
 * - `can_create_channel` on the organization (admin by default) — a
 *   channel spends the organization's own provider keys with people
 *   outside it, so it is an admin-level decision. The org check uses the
 *   agent's `metadata.org` as the resource id, which is the
 *   organization's id.
 *
 * A viewer from another organization looking at a platform-visible agent
 * needs no special case: both checks answer false for them, so the
 * affordance hides on permissions alone.
 *
 * On the open-source edition the answer follows the server's posture. A
 * server without sign-in has the permissive single-team authorizer and
 * answers allowed. A server with sign-in enforces the
 * same organization roles as the cloud, so `can_create_channel` is
 * the admin's and a member sees no create affordance.
 *
 * Pass `null` for `agent` while it loads — `allowed` stays `false` so
 * no affordance flashes before the gate can be evaluated.
 *
 * @param agent  The agent to reach, or `null` while loading.
 */
export function useCanCreateChannel(
  agent: Agent | null,
): UseCanCreateChannelReturn {
  const agentId = agent?.metadata?.id ?? "";
  const agentOrg = agent?.metadata?.org ?? "";

  const { allowed: canPublishAgent } = useCheckPermission(
    agentId ? { kind: "agent", id: agentId } : null,
    "can_manage_audience",
  );
  const { allowed: canCreateInOrg } = useCheckPermission(
    agentOrg ? { kind: "organization", id: agentOrg } : null,
    "can_create_channel",
  );

  return { allowed: !!agent && canPublishAgent && canCreateInOrg };
}
