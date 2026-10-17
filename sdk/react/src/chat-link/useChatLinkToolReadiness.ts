"use client";

import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { useDeploymentMode } from "../deployment-mode.js";
import {
  useToolCredentialsReadiness,
  type ToolCredentialsReadiness,
} from "../vault/useToolCredentialsReadiness.js";
import type { WebChannelDraft } from "./webChannelDraft.js";
import { agentUsesTools } from "../agent/runServers.js";

/**
 * Readiness of a chat link's tool credentials for visitor runs.
 *
 * The shared vocabulary lives on {@link ToolCredentialsReadiness}; this
 * alias names it for chat links.
 */
export type ChatLinkToolReadiness = ToolCredentialsReadiness;

/**
 * Chat-link wrapper over {@link useToolCredentialsReadiness}: checks
 * whether a tool-using agent's credentials will work for a chat link's
 * visitors — i.e. whether the link names vaults (`vaults`) and each
 * one is a shared vault.
 *
 * The check runs only when the link is enabled with a public audience
 * (org-audience links reject bindings at the proto boundary), the
 * deployment is cloud (local mode has no guest runtime or secret
 * gating), and the agent dials MCP servers (its own or its plugins', which read keys).
 */
export function useChatLinkToolReadiness(
  agent: Agent,
  draft: WebChannelDraft,
): ChatLinkToolReadiness {
  const deploymentMode = useDeploymentMode();
  const usesTools = agentUsesTools(agent.spec);
  const applicable =
    draft.enabled &&
    draft.audience === "public" &&
    deploymentMode === "cloud" &&
    usesTools;

  return useToolCredentialsReadiness(applicable, draft.vaults);
}
