"use client";

/**
 * Which keys a run of an agent reads from the person's My vault: the one reading the console's key line and the update
 * notice share, so neither names a key the server never fills.
 *
 * The server's rule (the execution context build): a run fills the keys
 * the agent declares (`spec.env`) from the running person's My vault only when the agent belongs to the run's own organization —
 * an agent another organization published reads none — and never fills an
 * MCP server's OAuth target variable, which comes only from that server's
 * sign-in. So the keys named here are the declared keys minus every OAuth
 * target of the agent's servers, and none at all for an agent of another
 * organization.
 *
 * The OAuth targets are read from the agent's servers; while they load
 * the answer is not ready, so a caller never names a key a moment later
 * withdrawn. A server that cannot be read leaves its variables named: the
 * line errs toward saying more, never less.
 *
 * Pinned by `__tests__/usePersonalKeys.test.tsx`.
 */

import { useMemo } from "react";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentSpec } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import { findOrgByRef, useOptionalOrg } from "../organization/OrgProvider.js";

/**
 * The id of the organization `ref` names (an id or a slug), through the
 * caller's organization list when one is mounted; `ref` itself otherwise.
 */
export function useOrganizationId(ref: string): string {
  const orgs = useOptionalOrg()?.orgs;
  return useMemo(
    () => (orgs ? findOrgByRef(orgs, ref)?.metadata?.id : undefined) || ref,
    [orgs, ref],
  );
}

/** Return value of {@link usePersonalKeys}. */
export interface UsePersonalKeysReturn {
  /** The keys, sorted; empty when there are none or the answer is not ready. */
  readonly keys: readonly string[];
  /** `true` once the agent's servers have been read and `keys` is the answer. */
  readonly isReady: boolean;
}

/**
 * The keys a run of `agent` at `spec` reads from the person's My vault, for a conversation in `runOrg` (an organization id, as
 * stored resources name it, or its slug). `spec` is the version the run will use: the
 * pinned one for a conversation that has one, else the agent's current
 * spec. Pass `null` for either while it loads.
 */
export function usePersonalKeys(
  agent: Agent | null,
  spec: AgentSpec | null | undefined,
  runOrg: string,
): UsePersonalKeysReturn {
  const stigmer = useStigmer();
  const runOrgId = useOrganizationId(runOrg);
  const sameOrganization =
    agent !== null && runOrgId !== "" && agent.metadata?.org === runOrgId;

  const { data: oauthTargets, isLoading } = useFetch(
    sameOrganization && spec
      ? async () => {
          const targets = new Set<string>();
          for (const usage of spec.mcpServerUsages ?? []) {
            const ref = usage.mcpServerRef;
            if (!ref) continue;
            try {
              const server = await stigmer.mcpServer.getByReference(ref);
              const target = server.spec?.auth?.targetEnvVar ?? "";
              if (target !== "") targets.add(target);
            } catch {
              // Unreadable: its variables stay named (the module header).
            }
          }
          return targets;
        }
      : null,
    [sameOrganization, spec, stigmer],
    null as Set<string> | null,
  );

  return useMemo(() => {
    if (agent === null || spec === null || spec === undefined) {
      return { keys: [], isReady: false };
    }
    if (!sameOrganization) {
      return { keys: [], isReady: true };
    }
    if (isLoading || oauthTargets === null) {
      return { keys: [], isReady: false };
    }
    const keys = Object.keys(spec.env ?? {})
      .filter((key) => !oauthTargets.has(key))
      .sort();
    return { keys, isReady: true };
  }, [agent, spec, sameOrganization, isLoading, oauthTargets]);
}
