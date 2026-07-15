"use client";

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { useDeploymentMode } from "../deployment-mode.js";
import {
  useToolCredentialsReadiness,
  type ToolCredentialsReadiness,
} from "../environment/useToolCredentialsReadiness.js";
import type { AgentShareDraft } from "./useSaveAgentShare.js";

/**
 * Readiness of a share's tool credentials for visitor executions.
 *
 * The shared vocabulary lives on {@link ToolCredentialsReadiness}; this
 * alias preserves the original share-scoped export.
 */
export type ShareToolReadiness = ToolCredentialsReadiness;

/**
 * Share-scoped wrapper over {@link useToolCredentialsReadiness}: checks
 * whether a tool-using shared agent's credentials will work for
 * visitors — i.e. whether the share binds environments
 * (`environment_refs`) and each one is shared with the organization.
 *
 * The check runs only when the share is enabled with a public audience
 * (org-audience shares reject bindings at the proto boundary), the
 * deployment is cloud (local mode has no guest runtime or secret
 * gating), and the agent declares MCP server usages.
 */
export function useShareToolReadiness(
  agent: Agent,
  draft: AgentShareDraft,
): ShareToolReadiness {
  const deploymentMode = useDeploymentMode();
  const hasMcpTools = (agent.spec?.mcpServerUsages?.length ?? 0) > 0;
  const applicable =
    draft.enabled &&
    draft.audience === "public" &&
    deploymentMode === "cloud" &&
    hasMcpTools;

  return useToolCredentialsReadiness(applicable, draft.environmentRefs);
}
