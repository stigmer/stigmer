"use client";

import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { useDeploymentMode } from "@stigmer/react-core";
import {
  useToolCredentialsReadiness,
  type ToolCredentialsReadiness,
} from "../vault/useToolCredentialsReadiness.js";
import type { WebChannelDraft } from "./webChannelDraft.js";
import { useRunUsesTools } from "../agent/useRunUsesTools.js";

/**
 * Readiness of a chat link's tool credentials for visitor runs.
 *
 * The shared vocabulary lives on {@link ToolCredentialsReadiness}; this
 * alias names it for chat links.
 */
export type ChatLinkToolReadiness = ToolCredentialsReadiness;

const CHECKING: ChatLinkToolReadiness = { status: "checking" };

/**
 * Chat-link wrapper over {@link useToolCredentialsReadiness}: checks
 * whether a tool-using agent's credentials will work for a chat link's
 * visitors — i.e. whether the link names vaults (`vaults`) and each
 * one is a shared vault. A tool-using agent is one whose run dials MCP
 * servers: the agent's own or its plugins', or those of a subagent it
 * lists.
 *
 * The check runs only when the link is enabled with a public audience
 * (org-audience links reject bindings at the proto boundary), the
 * deployment is cloud (local mode has no guest runtime or secret
 * gating), and the run dials MCP servers (the agent's or a subagent's it
 * lists, their own or their plugins', which read keys). While the
 * subagents are read the answer is `checking`.
 */
export function useChatLinkToolReadiness(
  agent: Agent,
  draft: WebChannelDraft,
): ChatLinkToolReadiness {
  const deploymentMode = useDeploymentMode();
  const usesTools = useRunUsesTools(agent);
  const surfaceApplies =
    draft.enabled &&
    draft.audience === "public" &&
    deploymentMode === "cloud";

  const readiness = useToolCredentialsReadiness(surfaceApplies && usesTools === true, draft.vaults);
  return surfaceApplies && usesTools === null ? CHECKING : readiness;
}
