"use client";

import { useEffect, useState } from "react";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { useStigmer } from "../hooks.js";
import { useDeploymentMode } from "../deployment-mode.js";

/**
 * Readiness of a shared agent's tool credentials for visitor (and
 * teammate) executions.
 *
 * - `na` — nothing to check: the agent uses no MCP tools, the check is
 *   disabled, or the deployment cannot serve guest chat (local mode).
 * - `checking` — lookups in flight.
 * - `ready` — every environment bound to the agent's default instance is
 *   shared with the organization.
 * - `blocked` — one or more bound environments are private; their
 *   `org/slug` references are listed for the hint copy.
 */
export type ShareToolReadiness =
  | { readonly status: "na" }
  | { readonly status: "checking" }
  | { readonly status: "ready" }
  | { readonly status: "blocked"; readonly privateEnvironments: readonly string[] };

const NA: ShareToolReadiness = { status: "na" };

/**
 * Data hook that checks whether a tool-using shared agent's credentials
 * will work for visitors — i.e. whether the environments bound to its
 * default instance are shared with the organization (`visibility_org`).
 *
 * Guest and teammate executions can only use org-shared environments;
 * a private environment's secrets are creator-only and silently
 * unavailable to them, so the agent's tools would fail at runtime. This
 * hook powers the Share dialog's pre-flight hint, catching the
 * misconfiguration at share time instead of at the visitor's first
 * message.
 *
 * Scope note: environments bound via `environment_refs` are the
 * supported credential path for shared agents. Credentials that only
 * exist in the owner's personal environment are also invisible to
 * guests, but are not detectable from the instance binding — the
 * runtime's enriched FAILED_PRECONDITION error covers that case.
 *
 * The check runs only when `enabled` is true, the deployment is cloud
 * (local mode has no guest runtime or secret gating), and the agent
 * declares MCP server usages. All lookups run as the owner viewing the
 * dialog, who can read the bound environments.
 */
export function useShareToolReadiness(
  agent: Agent,
  enabled: boolean,
): ShareToolReadiness {
  const stigmer = useStigmer();
  const deploymentMode = useDeploymentMode();
  const [readiness, setReadiness] = useState<ShareToolReadiness>(NA);

  const agentId = agent.metadata?.id ?? "";
  const hasMcpTools = (agent.spec?.mcpServerUsages?.length ?? 0) > 0;
  const defaultInstanceId = agent.status?.defaultInstanceId ?? "";

  const shouldCheck =
    enabled &&
    deploymentMode === "cloud" &&
    hasMcpTools &&
    defaultInstanceId !== "";

  useEffect(() => {
    if (!shouldCheck) {
      setReadiness(NA);
      return;
    }

    let cancelled = false;
    setReadiness({ status: "checking" });

    (async (): Promise<ShareToolReadiness> => {
      const instance = await stigmer.agentInstance.get(defaultInstanceId);
      const refs = instance.spec?.environmentRefs ?? [];
      if (refs.length === 0) {
        // No bound environments to assess. The tools may need no
        // credentials at all — do not warn on a guess.
        return NA;
      }

      const privateRefs: string[] = [];
      for (const ref of refs) {
        try {
          const env = await stigmer.environment.getByReference({
            org: ref.org,
            slug: ref.slug,
          });
          if (
            env.metadata?.visibility !== ApiResourceVisibility.visibility_org
          ) {
            privateRefs.push(`${ref.org}/${ref.slug}`);
          }
        } catch {
          // Unreadable ref (deleted, foreign): the runtime will skip it
          // for visitors too — surface it as blocking.
          privateRefs.push(`${ref.org}/${ref.slug}`);
        }
      }

      return privateRefs.length === 0
        ? { status: "ready" }
        : { status: "blocked", privateEnvironments: privateRefs };
    })().then(
      (result) => {
        if (!cancelled) setReadiness(result);
      },
      () => {
        // The hint is best-effort pre-flight advice — a failed check must
        // never block the dialog. The runtime error path still diagnoses.
        if (!cancelled) setReadiness(NA);
      },
    );

    return () => {
      cancelled = true;
    };
    // agentId stands in for the agent object identity: the inputs that
    // matter (instance id, MCP usage presence) are covered explicitly.
  }, [shouldCheck, defaultInstanceId, agentId, stigmer]);

  return readiness;
}
