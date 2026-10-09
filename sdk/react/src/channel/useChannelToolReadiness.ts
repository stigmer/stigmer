"use client";

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { ResourceRef } from "@stigmer/sdk";
import { useDeploymentMode } from "../deployment-mode.js";
import {
  useToolCredentialsReadiness,
  type ToolCredentialsReadiness,
} from "../vault/useToolCredentialsReadiness.js";

/**
 * Channel-scoped wrapper over {@link useToolCredentialsReadiness}:
 * checks whether a tool-using agent's credentials will work over a
 * channel — i.e. whether the channel names vaults
 * (`AgentChannelSpec.vaults`) and each one is a shared vault.
 *
 * Channel runs have no person, so they use only the channel's own vaults
 * — exactly the share contract, without the audience arm (channels have no
 * audience concept). So a tool-using agent on a channel naming no vault is
 * guaranteed to refuse every workspace message that needs a tool.
 *
 * The check runs only when serving is enabled (a paused channel serves
 * no traffic), the deployment is cloud (the channel runtime is
 * cloud-only), and the agent declares MCP server usages.
 */
export function useChannelToolReadiness(
  agent: Agent,
  enabled: boolean,
  vaults: readonly ResourceRef[],
): ToolCredentialsReadiness {
  const deploymentMode = useDeploymentMode();
  const hasMcpTools = (agent.spec?.mcpServerUsages?.length ?? 0) > 0;
  const applicable = enabled && deploymentMode === "cloud" && hasMcpTools;

  return useToolCredentialsReadiness(applicable, vaults);
}
