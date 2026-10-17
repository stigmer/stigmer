/**
 * Maps a turn's subagents to Cursor SDK custom sub-agent definitions.
 *
 * The Cursor SDK registers custom sub-agents via `AgentOptions.agents`
 * (`Record<name, AgentDefinition>`). Once registered, the parent agent can
 * delegate to them by name through the Task tool. This is the capability that
 * makes a turn's subagents invokable on the Cursor harness — parity with the
 * native deepagents harness, which compiles them into the graph.
 *
 * A turn's subagents are the saved agents its agent lists and the plugins'
 * agents. Each runs on Cursor with its instructions, its model (where
 * Cursor's registry section lists it, else the turn's) and its skills,
 * rendered into its prompt as the main agent's are (`formatSkillsSection`).
 * An `AgentDefinition` carries no tool list and no hook, and the hook cannot
 * tell which sub-agent made a call, so what a subagent brings beyond those
 * is refused at setup (`turn-setup.ts` `checkToolScope`): a saved subagent's
 * own plugins, hooks or lists, and a plugin subagent's lists. Every
 * registered subagent runs within the main agent's scope, which the hook
 * enforces. A main agent's `Agent(type, …)` type list is refused at setup on
 * this engine: Cursor's built-in sub-agent types start through a `task` call
 * that fires no hook on the 1.0.31 local runtime (live probe, 2026-10-05),
 * so nothing could hold them back. {@link subagentsInScope} still keeps a
 * type the list does not allow unregistered, for the turns that pass that
 * check.
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
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import type { TurnInput } from "../../harness/types.js";
import type { SkillMetadata } from "../../shared/skill-resolver.js";
import { subagentModel } from "../../shared/subagents.js";
import { formatSkillsSection } from "./prompt-builder.js";

/** One subagent as this engine registers it. */
export interface CursorSubagent {
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  /** The model it runs on; undefined runs the turn's. */
  readonly model: string | undefined;
  readonly skills: readonly SkillMetadata[];
}

/**
 * The names of the turn's subagents the main agent may start under its
 * `Agent(type, …)` list: the ones registered with the SDK and named in the
 * prompt.
 */
export function subagentNamesInScope(input: Pick<TurnInput, "blueprint" | "subagents" | "mcp">): string[] {
  return [...input.subagents.map((s) => s.name), ...input.blueprint.pluginAgents.map((a) => a.name)].filter((name) =>
    input.mcp.toolScope.allowsSubAgentType(name),
  );
}

/** The turn's subagents the main agent may start, as this engine registers them. */
export async function subagentsInScope(input: Pick<TurnInput, "blueprint" | "subagents" | "mcp" | "skills">): Promise<CursorSubagent[]> {
  const inScope = new Set(subagentNamesInScope(input));
  const saved = input.subagents
    .filter((subagent) => inScope.has(subagent.name))
    .map((subagent): CursorSubagent => ({
      name: subagent.name,
      description: subagent.description,
      instructions: subagent.instructions,
      model: subagent.model,
      skills: subagent.skills,
    }));
  const plugin: CursorSubagent[] = [];
  for (const agent of input.blueprint.pluginAgents) {
    if (!inScope.has(agent.name)) continue;
    plugin.push({
      name: agent.name,
      description: agent.description,
      instructions: agent.instructions,
      model: await subagentModel(agent.model, Harness.CURSOR),
      skills: input.skills.bySubAgent.get(agent.name) ?? [],
    });
  }
  return [...saved, ...plugin];
}

/**
 * Build the Cursor SDK `agents` map from the turn's subagents.
 *
 * Returns `undefined` (rather than an empty object) when there are no usable
 * entries, so callers can omit the `agents` option entirely.
 */
export function buildCursorSubAgentDefinitions(
  subagents: readonly CursorSubagent[],
): Record<string, AgentDefinition> | undefined {
  if (subagents.length === 0) return undefined;

  const agents: Record<string, AgentDefinition> = {};
  for (const subagent of subagents) {
    const name = subagent.name.trim();
    // The name is the SDK registration key and the handle the model uses to
    // delegate. Skip entries without one rather than register an unaddressable
    // sub-agent.
    if (!name) continue;

    // The instructions are the subagent's system prompt, its skills after
    // them; fall back defensively so a malformed definition still produces
    // an invokable subagent instead of being silently dropped.
    const instructions = subagent.instructions.trim() || subagent.description.trim() || name;
    const prompt = subagent.skills.length > 0 ? `${instructions}\n\n${formatSkillsSection(subagent.skills)}` : instructions;

    agents[name] = {
      description: subagent.description,
      prompt,
      model: subagent.model ? { id: subagent.model } : "inherit",
    };
  }

  return Object.keys(agents).length > 0 ? agents : undefined;
}
