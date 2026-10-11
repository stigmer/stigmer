"use client";

/**
 * Which keys a run of an agent reads from the person's My vault: the one reading the console's key line and the update
 * notice share, so neither names a key the server never fills.
 *
 * The server's rule (the run's value plan, `domain/vault/resolve.ts` in
 * the server): each declarer's keys are matched on their own, from the
 * running person's My vault when the conversation includes it and the
 * agent belongs to the run's own organization (an agent another
 * organization published reads none). The agent's `spec.env` lists its
 * own keys; each plugin it lists declares the keys its servers and hooks
 * read; each is read for the declarer that needs it. The login key of a
 * server that signs in is filled by a login at the server's address
 * first, so the person signs in for it rather than saving a key. So the
 * keys named here are the agent's and its plugins' keys minus every such
 * login key, and none at all for an agent of another organization.
 *
 * The plugins are read by reference; while they load the answer is not
 * ready, so a caller never names a key a moment later withdrawn. A plugin
 * that cannot be read names only the agent's own keys: its own are not
 * known, and the run refuses the plugin anyway.
 *
 * Pinned by `__tests__/usePersonalKeys.test.tsx`.
 */

import { useMemo } from "react";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentSpec } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import { pluginDeclarations, signInKeys } from "../plugin/pluginRequirements.js";
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
  /** `true` once the agent's plugins have been read and `keys` is the answer. */
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

  const agentOrg = agent?.metadata?.org ?? "";
  const { data: pluginKeys, isLoading } = useFetch(
    sameOrganization && spec
      ? async () => {
          const plugins: Plugin[] = [];
          for (const ref of spec.plugins ?? []) {
            try {
              plugins.push(await stigmer.plugin.getByReference({ org: ref.org || agentOrg, slug: ref.slug }));
            } catch {
              // Unreadable: its keys are not known (the module header).
            }
          }
          return { declared: Object.keys(pluginDeclarations(plugins)), signIn: signInKeys(plugins) };
        }
      : null,
    [sameOrganization, spec, agentOrg, stigmer],
    null as { readonly declared: readonly string[]; readonly signIn: ReadonlySet<string> } | null,
  );

  return useMemo(() => {
    if (agent === null || spec === null || spec === undefined) {
      return { keys: [], isReady: false };
    }
    if (!sameOrganization) {
      return { keys: [], isReady: true };
    }
    if (isLoading || pluginKeys === null) {
      return { keys: [], isReady: false };
    }
    const keys = [...new Set([...Object.keys(spec.env ?? {}), ...pluginKeys.declared])]
      .filter((key) => !pluginKeys.signIn.has(key))
      .sort();
    return { keys, isReady: true };
  }, [agent, spec, sameOrganization, isLoading, pluginKeys]);
}
