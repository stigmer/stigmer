"use client";

/**
 * Adds a plugin to an agent the user already runs: its MCP servers, its
 * hooks, or both.
 *
 * A plugin that installs tools and no agent (most of the catalogue) leaves
 * the user one step short of a session, and a plugin with hooks guards no
 * agent until one names it; this hook is that step for an existing agent (a
 * new one with servers is the creation wizard's, entered with the servers
 * preselected). The agent is fetched on the pick, for two reasons the caller
 * cannot see from a search result: the update is a full spec replacement
 * over `toAgentUpdateInput`, and an agent a plugin installed is refused on
 * update by the server, so the hook says so first, from the
 * `stigmer.ai/plugin` label the search result does not carry. Servers the
 * agent already lists are left as they are; the rest are appended with no
 * tool selection, which means every tool, the agent page's default. The
 * hooks are switched on by `withPluginHooks`, the spec edit the agent page
 * makes too: the plugin named in `hooks`, and the variables its hooks read
 * declared on the agent.
 */

import { useCallback, useMemo, useState } from "react";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { HookConfig } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { type AgentInput, type McpServerUsageInput, type ResourceRef, toAgentUpdateInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { useUpdateAgent } from "../agent/useUpdateAgent.js";
import { PLUGIN_LABEL } from "./useManagingPlugin.js";
import { hookVariablesToDeclare, listsPluginHooks, withPluginHooks } from "./plugin-on-agent.js";

/** A server the dialog offers, by reference and by the name the user reads. */
export interface AddableServer {
  readonly ref: ResourceRef;
  readonly name: string;
}

/** A plugin's hooks the dialog offers: the plugin by reference, and the hooks it recorded at install. */
export interface AddableHooks {
  readonly plugin: ResourceRef;
  readonly config: HookConfig;
}

/** What adding a plugin to an agent offers: its servers, its hooks, or both. */
export interface PluginOffer {
  readonly servers: readonly AddableServer[];
  readonly hooks?: AddableHooks;
}

/** What an add changed on the agent. */
export interface AddPluginOutcome {
  /** How many servers were appended. */
  readonly servers: number;
  /** Whether the plugin's hooks were switched on (`false` when the agent already named the plugin). */
  readonly hooks: boolean;
  /** The variables declared on the agent for the hooks; the agent asks for each when a session starts. */
  readonly variables: readonly string[];
}

/** Where the flow stands. */
export type AddPluginPhase =
  | { readonly status: "picking" }
  | { readonly status: "reading"; readonly ref: ResourceRef }
  /** The pick is an agent a plugin installed; the server would refuse the update, so the dialog says why instead. */
  | { readonly status: "managed"; readonly agent: Agent }
  | {
      readonly status: "ready";
      readonly agent: Agent;
      /** Names of the offered servers the agent already lists. */
      readonly alreadyListed: readonly string[];
      /** Whether the agent's hooks already name the plugin. */
      readonly hooksListed: boolean;
      /** The variables the add would declare on the agent. */
      readonly variables: readonly string[];
    }
  | { readonly status: "adding"; readonly agent: Agent }
  | { readonly status: "added"; readonly agent: Agent; readonly outcome: AddPluginOutcome };

/** Return value of {@link useAddPluginToAgent}. */
export interface UseAddPluginToAgentReturn {
  readonly phase: AddPluginPhase;
  /** The pick from the agent picker; `null` returns to picking. */
  readonly pick: (ref: ResourceRef | null) => void;
  /** Add what the agent does not have yet and save. Resolves to what changed. */
  readonly add: () => Promise<AddPluginOutcome>;
  readonly error: Error | null;
  readonly clearError: () => void;
  readonly reset: () => void;
}

const NOTHING: AddPluginOutcome = { servers: 0, hooks: false, variables: [] };

/**
 * Behaviour hook behind {@link AddPluginToAgentDialog}.
 *
 * @example
 * ```tsx
 * const flow = useAddPluginToAgent({ servers, hooks: { plugin: ref, config: plugin.status.hooks } });
 * <AgentPicker org={org} value={picked} onChange={flow.pick} />
 * ```
 */
export function useAddPluginToAgent(offer: PluginOffer): UseAddPluginToAgentReturn {
  const stigmer = useStigmer();
  const { update } = useUpdateAgent();
  const [phase, setPhase] = useState<AddPluginPhase>({ status: "picking" });
  const [error, setError] = useState<Error | null>(null);
  const { servers, hooks } = offer;

  const readyFor = useCallback(
    (agent: Agent): AddPluginPhase => {
      const input = toAgentUpdateInput(agent);
      const listed = listedServers(input);
      return {
        status: "ready",
        agent,
        alreadyListed: servers.filter((server) => listed.has(usageKey(server.ref.org, server.ref.slug))).map((server) => server.name),
        hooksListed: hooks !== undefined && listsPluginHooks(input, hooks.plugin),
        variables: hooks === undefined ? [] : hookVariablesToDeclare(input, hooks.config),
      };
    },
    [servers, hooks],
  );

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
          setPhase(agent.metadata?.labels[PLUGIN_LABEL] ? { status: "managed", agent } : readyFor(agent));
        })
        .catch((err: unknown) => {
          setError(toError(err));
          setPhase({ status: "picking" });
        });
    },
    [stigmer, readyFor],
  );

  const add = useCallback(async (): Promise<AddPluginOutcome> => {
    if (phase.status !== "ready") return NOTHING;
    const { agent } = phase;
    const input = toAgentUpdateInput(agent);
    const listed = listedServers(input);
    const appended: McpServerUsageInput[] = servers
      .filter((server) => !listed.has(usageKey(server.ref.org, server.ref.slug)))
      .map((server) => ({ mcpServerRef: { org: server.ref.org, slug: server.ref.slug } }));
    const withServers: AgentInput = { ...input, mcpServerUsages: [...(input.mcpServerUsages ?? []), ...appended] };
    const next = hooks === undefined ? withServers : withPluginHooks(withServers, hooks.plugin, hooks.config);
    const outcome: AddPluginOutcome = {
      servers: appended.length,
      hooks: hooks !== undefined && !phase.hooksListed,
      variables: phase.variables,
    };
    setPhase({ status: "adding", agent });
    setError(null);
    try {
      const updated = await update(next);
      setPhase({ status: "added", agent: updated, outcome });
      return outcome;
    } catch (err) {
      const wrapped = toError(err);
      setError(wrapped);
      setPhase(phase);
      throw wrapped;
    }
  }, [phase, servers, hooks, update]);

  const clearError = useCallback(() => setError(null), []);
  const reset = useCallback(() => {
    setError(null);
    setPhase({ status: "picking" });
  }, []);

  return useMemo(() => ({ phase, pick, add, error, clearError, reset }), [phase, pick, add, error, clearError, reset]);
}

function listedServers(input: AgentInput): ReadonlySet<string> {
  return new Set((input.mcpServerUsages ?? []).map((usage) => usageKey(usage.mcpServerRef.org, usage.mcpServerRef.slug)));
}

function usageKey(org: string, slug: string): string {
  return `${org}/${slug}`;
}
