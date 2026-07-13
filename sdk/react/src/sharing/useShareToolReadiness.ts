"use client";

import { useEffect, useMemo, useState } from "react";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { useStigmer } from "../hooks.js";
import { useDeploymentMode } from "../deployment-mode.js";
import type { AgentShareDraft } from "./useSaveAgentShare.js";

/**
 * Readiness of a share's tool credentials for visitor executions.
 *
 * - `na` — nothing to check: the agent uses no MCP tools, sharing is
 *   off, the audience is org (bindings are public-audience only), or
 *   the deployment cannot serve guest chat (local mode).
 * - `needs-credentials` — the agent uses MCP tools but the share has no
 *   environments bound: visitors' tool calls will fail until the owner
 *   binds credentials.
 * - `checking` — lookups in flight.
 * - `ready` — every environment bound to the share is shared with the
 *   organization.
 * - `blocked` — one or more bound environments are private; their
 *   `org/slug` references are listed for the hint copy.
 */
export type ShareToolReadiness =
  | { readonly status: "na" }
  | { readonly status: "needs-credentials" }
  | { readonly status: "checking" }
  | { readonly status: "ready" }
  | { readonly status: "blocked"; readonly privateEnvironments: readonly string[] };

const NA: ShareToolReadiness = { status: "na" };
const NEEDS_CREDENTIALS: ShareToolReadiness = { status: "needs-credentials" };

/**
 * Data hook that checks whether a tool-using shared agent's credentials
 * will work for visitors — i.e. whether the share binds environments
 * (`environment_refs`) and each one is shared with the organization
 * (`visibility_org`).
 *
 * Guest executions receive credentials exclusively from the share's own
 * `environment_refs`, resolved through the org-shared environment seam
 * (decision 011 — the agent's default instance stays pristine and is
 * never consulted). So a tool-using agent with an empty binding list is
 * *guaranteed* broken for visitors, and this hook says so explicitly
 * (`needs-credentials`) instead of staying silent — the gap that made
 * session 12's misconfiguration invisible until a visitor's first
 * message failed.
 *
 * The check runs only when the share is enabled with a public audience
 * (org-audience shares reject bindings at the proto boundary), the
 * deployment is cloud (local mode has no guest runtime or secret
 * gating), and the agent declares MCP server usages. All lookups run as
 * the owner viewing the dialog, who can read the bound environments.
 */
export function useShareToolReadiness(
  agent: Agent,
  draft: AgentShareDraft,
): ShareToolReadiness {
  const stigmer = useStigmer();
  const deploymentMode = useDeploymentMode();
  const [checked, setChecked] = useState<ShareToolReadiness>(NA);

  const hasMcpTools = (agent.spec?.mcpServerUsages?.length ?? 0) > 0;
  const applicable =
    draft.enabled &&
    draft.audience === "public" &&
    deploymentMode === "cloud" &&
    hasMcpTools;

  // Stable key for the effect: the visibility lookups depend only on
  // which environments are bound, not on the array's identity.
  const refsKey = useMemo(
    () => draft.environmentRefs.map((ref) => `${ref.org}/${ref.slug}`).join(","),
    [draft.environmentRefs],
  );

  const shouldFetch = applicable && refsKey !== "";

  useEffect(() => {
    if (!shouldFetch) {
      setChecked(NA);
      return;
    }

    let cancelled = false;
    setChecked({ status: "checking" });

    (async (): Promise<ShareToolReadiness> => {
      const privateRefs: string[] = [];
      for (const ref of refsKey.split(",")) {
        const [org, slug] = ref.split("/");
        try {
          const env = await stigmer.environment.getByReference({ org, slug });
          if (
            env.metadata?.visibility !== ApiResourceVisibility.visibility_org
          ) {
            privateRefs.push(ref);
          }
        } catch {
          // Unreadable ref (deleted, foreign): the runtime's merge will
          // skip it for visitors too — surface it as blocking.
          privateRefs.push(ref);
        }
      }

      return privateRefs.length === 0
        ? { status: "ready" }
        : { status: "blocked", privateEnvironments: privateRefs };
    })().then(
      (result) => {
        if (!cancelled) setChecked(result);
      },
      () => {
        // The hint is best-effort pre-flight advice — a failed check must
        // never block the dialog. The runtime error path still diagnoses.
        if (!cancelled) setChecked(NA);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [shouldFetch, refsKey, stigmer]);

  if (!applicable) return NA;
  // Zero bindings needs no lookup: a tool-using agent without bound
  // credentials is broken for visitors by construction.
  if (refsKey === "") return NEEDS_CREDENTIALS;
  return checked;
}
