"use client";

import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { ResourceRef } from "@stigmer/client";
import { useDeploymentMode } from "@stigmer/react-core";
import {
  useToolCredentialsReadiness,
  type ToolCredentialsReadiness,
} from "../vault/useToolCredentialsReadiness.js";
import { useRunUsesTools } from "../agent/useRunUsesTools.js";

const CHECKING: ToolCredentialsReadiness = { status: "checking" };

/**
 * Channel-scoped wrapper over {@link useToolCredentialsReadiness}:
 * checks whether a tool-using agent's credentials will work over a
 * channel — i.e. whether the channel names vaults
 * (`ChannelSpec.vaults`) and each one is a shared vault. A tool-using
 * agent is one whose run dials MCP servers: the agent's own or its
 * plugins', or those of a subagent it lists.
 *
 * Channel runs have no person, so they use only the channel's own vaults
 * — exactly the share contract, without the audience arm (channels have no
 * audience concept). So a tool-using agent on a channel naming no vault is
 * guaranteed to refuse every workspace message that needs a tool.
 *
 * The check runs only when serving is enabled (a paused channel serves
 * no traffic), the deployment is cloud (the channel runtime is
 * cloud-only), and the run dials MCP servers (the agent's or a subagent's
 * it lists, their own or their plugins', which read keys). While the
 * subagents are read the answer is `checking`.
 *
 * A channel can run one saved version of its agent rather than the
 * current one: `agentVersion` is the version its agent reference names
 * (`channel.spec?.agentRef?.version`), a tag or a content hash, and the
 * check judges that version's tools and subagents, read fresh, since a tag
 * can move. None or `"latest"` judges `agent` as given. While the version
 * is read the answer is `checking`, and it stays `checking` when the
 * version cannot be read: that channel's conversations are refused for a
 * reason other than vaults.
 *
 * @param agent - The channel's agent, as it is today.
 * @param enabled - Whether the channel serves traffic.
 * @param vaults - The vaults the channel names.
 * @param agentVersion - The agent version the channel runs; defaults to the current one.
 */
export function useChannelToolReadiness(
  agent: Agent,
  enabled: boolean,
  vaults: readonly ResourceRef[],
  agentVersion = "",
): ToolCredentialsReadiness {
  const deploymentMode = useDeploymentMode();
  const usesTools = useRunUsesTools(agent, agentVersion);
  const surfaceApplies = enabled && deploymentMode === "cloud";

  const readiness = useToolCredentialsReadiness(surfaceApplies && usesTools === true, vaults);
  return surfaceApplies && usesTools === null ? CHECKING : readiness;
}
