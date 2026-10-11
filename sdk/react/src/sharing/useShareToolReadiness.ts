"use client";

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { useDeploymentMode } from "../deployment-mode.js";
import {
  useToolCredentialsReadiness,
  type ToolCredentialsReadiness,
} from "../vault/useToolCredentialsReadiness.js";
import type { AgentShareDraft } from "./useSaveAgentShare.js";

/**
 * Readiness of a share's tool credentials for visitor runs.
 *
 * The shared vocabulary lives on {@link ToolCredentialsReadiness}; this
 * alias preserves the original share-scoped export.
 */
export type ShareToolReadiness = ToolCredentialsReadiness;

/**
 * Share-scoped wrapper over {@link useToolCredentialsReadiness}: checks
 * whether a tool-using shared agent's credentials will work for
 * visitors — i.e. whether the share names vaults (`vaults`) and each
 * one is a shared vault.
 *
 * The check runs only when the share is enabled with a public audience
 * (org-audience shares reject bindings at the proto boundary), the
 * deployment is cloud (local mode has no guest runtime or secret
 * gating), and the agent lists plugins (whose servers read keys).
 */
export function useShareToolReadiness(
  agent: Agent,
  draft: AgentShareDraft,
): ShareToolReadiness {
  const deploymentMode = useDeploymentMode();
  const usesPlugins = (agent.spec?.plugins?.length ?? 0) > 0;
  const applicable =
    draft.enabled &&
    draft.audience === "public" &&
    deploymentMode === "cloud" &&
    usesPlugins;

  return useToolCredentialsReadiness(applicable, draft.vaults);
}
