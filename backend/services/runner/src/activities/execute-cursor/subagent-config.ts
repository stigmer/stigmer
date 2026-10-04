/**
 * Maps Stigmer SubAgent blueprints to Cursor SDK custom sub-agent definitions.
 *
 * The Cursor SDK registers custom sub-agents via `AgentOptions.agents`
 * (`Record<name, AgentDefinition>`). Once registered, the parent agent can
 * delegate to them by name through the Task tool. This is the capability that
 * makes blueprint sub-agents actually invokable on the Cursor harness — parity
 * with the native deepagents harness, which compiles them into the graph.
 *
 * Tool lists: an `AgentDefinition` carries no tool list, and the hook cannot
 * tell which sub-agent made a call, so a sub-agent with lists of its own is
 * refused at setup (`turn-setup.ts` `checkToolScope`); every registered
 * sub-agent runs within the main agent's scope, which the hook enforces. The
 * main agent's `Agent(type, …)` is honoured twice: a custom type it does not
 * allow is never registered ({@link subAgentsInScope}), and the hook's
 * `subagentStart` arm refuses any type it does not allow, Cursor's built-in
 * ones included.
 *
 * Built-in kinds (`explore`, `shell`, `generalPurpose`) are provided by
 * Cursor's own runtime and must NOT be registered here — doing so would
 * shadow the native ones. They are encouraged via prompt guidance instead.
 *
 * Because the SDK does not persist agent configuration across `Agent.resume()`
 * (the same constraint that applies to `mcpServers`), the result of this
 * mapper must be supplied on every create AND resume call so the delegation
 * capability survives across turns.
 */

import type { AgentDefinition } from "@cursor/sdk";
import type { SubAgent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { ToolScope } from "../../shared/tool-lists.js";

/**
 * The blueprint sub-agents the main agent may start under its `Agent(type, …)`
 * list: the ones registered with the SDK and named in the prompt.
 */
export function subAgentsInScope(subAgents: readonly SubAgent[], scope: ToolScope): SubAgent[] {
  return subAgents.filter((sa) => scope.allowsSubAgentType(sa.name));
}

/**
 * Build the Cursor SDK `agents` map from blueprint sub-agents.
 *
 * Returns `undefined` (rather than an empty object) when there are no usable
 * entries, so callers can omit the `agents` option entirely.
 *
 * @param subAgents Blueprint sub-agents from `Agent.spec.sub_agents`.
 */
export function buildCursorSubAgentDefinitions(
  subAgents: readonly SubAgent[],
): Record<string, AgentDefinition> | undefined {
  if (subAgents.length === 0) return undefined;

  const agents: Record<string, AgentDefinition> = {};
  for (const sa of subAgents) {
    const name = sa.name?.trim();
    // The name is the SDK registration key and the handle the model uses to
    // delegate. Skip entries without one rather than register an unaddressable
    // sub-agent.
    if (!name) continue;

    // instructions is the sub-agent's system prompt. The proto requires it
    // (min_len 10), but fall back defensively so a malformed blueprint still
    // produces an invokable sub-agent instead of being silently dropped.
    const prompt = sa.instructions?.trim() || sa.description?.trim() || name;

    agents[name] = {
      description: sa.description ?? "",
      prompt,
      model: sa.modelOverride ? { id: sa.modelOverride } : "inherit",
    };
  }

  return Object.keys(agents).length > 0 ? agents : undefined;
}
