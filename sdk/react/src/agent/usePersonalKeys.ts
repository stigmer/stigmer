"use client";

/**
 * Which values a run of an agent takes from the person's own credentials:
 * the line the composer shows before the first message, so the person
 * knows what the agent will receive of theirs.
 *
 * The reading is the resolver's (`credential/requirements.ts`,
 * `personReadiness`): every requirement of the run (the agent's own keys,
 * each MCP server's), each met from the person's own credential serving
 * its declarer. Values the organization gives, or that nothing gives yet,
 * are not the person's and are not named. A server that cannot be read is
 * left out of the reading rather than failing it; while the requirements
 * or the credentials load the answer is not ready, so a caller never names
 * a key a moment later withdrawn.
 *
 * Pinned by `__tests__/usePersonalKeys.test.tsx`.
 */

import { useMemo } from "react";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentSpec } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import { findOrgByRef, useOptionalOrg } from "../organization/OrgProvider.js";
import { personReadiness, readRunRequirements, type Requirement } from "../credential/requirements.js";
import { useCredentialList } from "../credential/useCredentialList.js";

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
  /** `true` once the requirements and the credentials have been read and `keys` is the answer. */
  readonly isReady: boolean;
}

/**
 * The keys a run of `agent` at `spec` takes from the person's own
 * credentials, for a conversation in `runOrg` (an organization id, as
 * stored resources name it, or its slug). `spec` is the version the run
 * will use: the pinned one for a conversation that has one, else the
 * agent's current spec. Pass `null` for either while it loads.
 */
export function usePersonalKeys(
  agent: Agent | null,
  spec: AgentSpec | null | undefined,
  runOrg: string,
): UsePersonalKeysReturn {
  const stigmer = useStigmer();
  const runOrgId = useOrganizationId(runOrg);
  const ready = agent !== null && spec !== null && spec !== undefined && runOrgId !== "";

  const { data: requirements, isLoading } = useFetch(
    ready
      ? async () =>
          (await readRunRequirements(stigmer, agent, { spec, unreadableServer: "skip" })).requirements
      : null,
    [ready, agent, spec, stigmer],
    null as Requirement[] | null,
  );
  const credentials = useCredentialList(ready ? runOrgId : null);

  return useMemo(() => {
    if (!ready || isLoading || requirements === null || credentials.isLoading) {
      return { keys: [], isReady: false };
    }
    const { met } = personReadiness(requirements, { credentials: credentials.credentials });
    const keys = [
      ...new Set(met.filter(({ source }) => source === "own").map(({ requirement }) => requirement.key)),
    ].sort();
    return { keys, isReady: true };
  }, [ready, isLoading, requirements, credentials.isLoading, credentials.credentials]);
}
