"use client";

/**
 * Adds a plugin's MCP servers to an agent the user already runs.
 *
 * A plugin that installs tools and no agent (most of the catalogue) leaves
 * the user one step short of a session; this hook is that step for an
 * existing agent (a new one is the creation wizard's, entered with the
 * servers preselected). The agent is fetched on the pick, for two reasons
 * the caller cannot see from a search result: the update is a full spec
 * replacement over `toAgentUpdateInput`, and an agent a plugin installed
 * is refused on update by the server, so the hook says so first, from the
 * `stigmer.ai/plugin` label the search result does not carry. Servers the
 * agent already lists are left as they are; the rest are appended with no
 * tool selection, which means every tool, the agent page's default.
 */

import { useCallback, useMemo, useState } from "react";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { type McpServerUsageInput, type ResourceRef, toAgentUpdateInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { useUpdateAgent } from "../agent/useUpdateAgent.js";
import { PLUGIN_LABEL } from "./useManagingPlugin.js";

/** A server the dialog offers, by reference and by the name the user reads. */
export interface AddableServer {
  readonly ref: ResourceRef;
  readonly name: string;
}

/** Where the flow stands. */
export type AddToolsPhase =
  | { readonly status: "picking" }
  | { readonly status: "reading"; readonly ref: ResourceRef }
  /** The pick is an agent a plugin installed; the server would refuse the update, so the dialog says why instead. */
  | { readonly status: "managed"; readonly agent: Agent }
  | { readonly status: "ready"; readonly agent: Agent; readonly alreadyListed: readonly string[] }
  | { readonly status: "adding"; readonly agent: Agent }
  | { readonly status: "added"; readonly agent: Agent; readonly addedCount: number };

/** Return value of {@link useAddToolsToAgent}. */
export interface UseAddToolsToAgentReturn {
  readonly phase: AddToolsPhase;
  /** The pick from the agent picker; `null` returns to picking. */
  readonly pick: (ref: ResourceRef | null) => void;
  /** Append the servers not already listed and save. Resolves to the number added. */
  readonly add: () => Promise<number>;
  readonly error: Error | null;
  readonly clearError: () => void;
  readonly reset: () => void;
}

/**
 * Behaviour hook behind {@link AddToolsToAgentDialog}.
 *
 * @example
 * ```tsx
 * const flow = useAddToolsToAgent(servers);
 * <AgentPicker org={org} value={picked} onChange={flow.pick} />
 * ```
 */
export function useAddToolsToAgent(servers: readonly AddableServer[]): UseAddToolsToAgentReturn {
  const stigmer = useStigmer();
  const { update } = useUpdateAgent();
  const [phase, setPhase] = useState<AddToolsPhase>({ status: "picking" });
  const [error, setError] = useState<Error | null>(null);

  const pick = useCallback(
    (ref: ResourceRef | null) => {
      setError(null);
      if (ref === null) {
        setPhase({ status: "picking" });
        return;
      }
      setPhase({ status: "reading", ref });
      void stigmer.agent
        .getByReference(ref)
        .then((agent) => {
          if (agent.metadata?.labels[PLUGIN_LABEL]) {
            setPhase({ status: "managed", agent });
            return;
          }
          const listed = new Set((agent.spec?.mcpServerUsages ?? []).map((usage) => usageKey(usage.mcpServerRef?.org ?? "", usage.mcpServerRef?.slug ?? "")));
          const alreadyListed = servers.filter((server) => listed.has(usageKey(server.ref.org, server.ref.slug))).map((server) => server.name);
          setPhase({ status: "ready", agent, alreadyListed });
        })
        .catch((err: unknown) => {
          setError(toError(err));
          setPhase({ status: "picking" });
        });
    },
    [stigmer, servers],
  );

  const add = useCallback(async (): Promise<number> => {
    if (phase.status !== "ready") return 0;
    const { agent } = phase;
    const input = toAgentUpdateInput(agent);
    const listed = new Set((input.mcpServerUsages ?? []).map((usage) => usageKey(usage.mcpServerRef.org, usage.mcpServerRef.slug)));
    const appended: McpServerUsageInput[] = servers
      .filter((server) => !listed.has(usageKey(server.ref.org, server.ref.slug)))
      .map((server) => ({ mcpServerRef: { org: server.ref.org, slug: server.ref.slug } }));
    setPhase({ status: "adding", agent });
    setError(null);
    try {
      const updated = await update({ ...input, mcpServerUsages: [...(input.mcpServerUsages ?? []), ...appended] });
      setPhase({ status: "added", agent: updated, addedCount: appended.length });
      return appended.length;
    } catch (err) {
      const wrapped = toError(err);
      setError(wrapped);
      setPhase({ status: "ready", agent, alreadyListed: phase.alreadyListed });
      throw wrapped;
    }
  }, [phase, servers, update]);

  const clearError = useCallback(() => setError(null), []);
  const reset = useCallback(() => {
    setError(null);
    setPhase({ status: "picking" });
  }, []);

  return useMemo(() => ({ phase, pick, add, error, clearError, reset }), [phase, pick, add, error, clearError, reset]);
}

function usageKey(org: string, slug: string): string {
  return `${org}/${slug}`;
}
