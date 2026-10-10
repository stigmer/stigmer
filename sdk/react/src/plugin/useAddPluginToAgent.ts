"use client";

/**
 * Adds a plugin to an agent the user already runs: the plugin appended to
 * the agent's `plugins`, which gives the agent the plugin whole (its
 * skills, agents, hooks and MCP servers).
 *
 * The agent is fetched on the pick, for two reasons the caller cannot see
 * from a search result: the update is a full spec replacement over
 * `toAgentUpdateInput`, and an agent a plugin installed is refused on
 * update by the server, so the hook says so first, from the
 * `stigmer.ai/plugin` label the search result does not carry. The read
 * also says whether the agent lists the plugin already, and whether the
 * agent's own tool list leaves the plugin's servers out: an agent that
 * names the tools it may use reaches a plugin's server only when the list
 * names it, so the dialog says so rather than adding tools the author did
 * not choose. The edit itself is `withPlugin`, the one the agent page makes.
 */

import { useCallback, useMemo, useState } from "react";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { toolServerSegment } from "@stigmer/plugin-package";
import { type AgentInput, type ResourceRef, toAgentUpdateInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { useUpdateAgent } from "../agent/useUpdateAgent.js";
import { PLUGIN_LABEL } from "./useManagingPlugin.js";
import { listsPlugin, withPlugin } from "./plugin-on-agent.js";

/** The plugin an add puts on an agent. */
export interface PluginOffer {
  /** The plugin, by reference. */
  readonly plugin: ResourceRef;
  /** The plugin's name, as a turn names its tools. */
  readonly name: string;
  /** The names of the plugin's MCP servers. */
  readonly servers: readonly string[];
}

/** What an add changed on the agent. */
export interface AddPluginOutcome {
  /** Whether the plugin was appended (`false` when the agent already listed it). */
  readonly added: boolean;
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
      /** Whether the agent already lists the plugin. */
      readonly alreadyListed: boolean;
      /** Whether the agent names the tools it may use and the list names none of the plugin's servers. */
      readonly toolsLeaveOut: boolean;
    }
  | { readonly status: "adding"; readonly agent: Agent }
  | { readonly status: "added"; readonly agent: Agent; readonly outcome: AddPluginOutcome };

/** Return value of {@link useAddPluginToAgent}. */
export interface UseAddPluginToAgentReturn {
  readonly phase: AddPluginPhase;
  /** The pick from the agent picker; `null` returns to picking. */
  readonly pick: (ref: ResourceRef | null) => void;
  /** Add the plugin unless the agent lists it, and save. Resolves to what changed. */
  readonly add: () => Promise<AddPluginOutcome>;
  readonly error: Error | null;
  readonly clearError: () => void;
  readonly reset: () => void;
}

const NOTHING: AddPluginOutcome = { added: false };

/**
 * Behaviour hook behind {@link AddPluginToAgentDialog}.
 *
 * @example
 * ```tsx
 * const flow = useAddPluginToAgent({ plugin: { org, slug }, name: "linear", servers: ["linear"] });
 * <AgentPicker org={org} value={picked} onChange={flow.pick} />
 * ```
 */
export function useAddPluginToAgent(offer: PluginOffer): UseAddPluginToAgentReturn {
  const stigmer = useStigmer();
  const { update } = useUpdateAgent();
  const [phase, setPhase] = useState<AddPluginPhase>({ status: "picking" });
  const [error, setError] = useState<Error | null>(null);
  const { plugin, name, servers } = offer;

  const readyFor = useCallback(
    (agent: Agent): AddPluginPhase => {
      const input = toAgentUpdateInput(agent);
      return {
        status: "ready",
        agent,
        alreadyListed: listsPlugin(input, plugin),
        toolsLeaveOut: toolsLeaveOut(input, name, servers),
      };
    },
    [plugin, name, servers],
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
    const outcome: AddPluginOutcome = { added: !phase.alreadyListed };
    if (!outcome.added) {
      setPhase({ status: "added", agent, outcome });
      return outcome;
    }
    setPhase({ status: "adding", agent });
    setError(null);
    try {
      const updated = await update(withPlugin(toAgentUpdateInput(agent), plugin));
      setPhase({ status: "added", agent: updated, outcome });
      return outcome;
    } catch (err) {
      const wrapped = toError(err);
      setError(wrapped);
      setPhase(phase);
      throw wrapped;
    }
  }, [phase, plugin, update]);

  const clearError = useCallback(() => setError(null), []);
  const reset = useCallback(() => {
    setError(null);
    setPhase({ status: "picking" });
  }, []);

  return useMemo(() => ({ phase, pick, add, error, clearError, reset }), [phase, pick, add, error, clearError, reset]);
}

/**
 * Whether the agent names the tools it may use and none of the plugin's
 * servers is among them: `mcp__*`, or `mcp__<server segment>` with or
 * without a tool, lets a server through.
 */
export function toolsLeaveOut(input: AgentInput, pluginName: string, servers: readonly string[]): boolean {
  const tools = input.tools ?? [];
  if (tools.length === 0 || servers.length === 0) return false;
  if (tools.includes("mcp__*")) return false;
  return !servers.some((server) => {
    const prefix = `mcp__${toolServerSegment(pluginName, server)}`;
    return tools.some((tool) => tool === prefix || tool.startsWith(`${prefix}__`));
  });
}
