/**
 * The rules every engine reads about a turn's subagents, in one place: the
 * tool scope a saved subagent and a plugin subagent each run under, and the
 * model each runs on. Pure but for the model registry read; no engine
 * import, so both harnesses and the runtime share it.
 *
 * One level: every subagent's scope denies `Agent` ({@link ONE_LEVEL_LAYER}),
 * so no subagent's graph offers the tool that hands work on, and a call to
 * it is refused, on the saved agents a turn's agent lists and on the
 * plugins' agents alike.
 */
import type { AgentSpec } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import type { RunSpec } from "@stigmer/apis/ai/stigmer/agentic/run/v1/spec_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import { isModelListedFor, type RegistryHarness } from "./model-registry.js";
import { ToolScope } from "./tool-lists.js";

/** The owner a saved subagent's lists are reported under, in a log line or a refusal. */
export function subagentOwner(name: string): string {
  return `Subagent "${name}"`;
}

/** The layer that keeps every subagent from handing work on (the one-level rule). */
export const ONE_LEVEL_LAYER = {
  owner: "A subagent",
  lists: { tools: [] as string[], disallowedTools: ["Agent"] },
} as const;

/**
 * A saved subagent's tool scope: its own lists, then the turn's as a cap,
 * then `Agent` denied, so its graph never sees the tool that hands work
 * on. Never the main agent's lists: a saved agent runs its own definition,
 * whoever lists it.
 */
export function savedSubagentScope(name: string, spec: AgentSpec, runSpec: RunSpec | undefined): ToolScope {
  return ToolScope.ofMain([
    { owner: subagentOwner(name), lists: { tools: spec.tools, disallowedTools: spec.disallowedTools } },
    { owner: "The turn", lists: { tools: runSpec?.tools ?? [], disallowedTools: runSpec?.disallowedTools ?? [] } },
    ONE_LEVEL_LAYER,
  ]);
}

/**
 * A plugin subagent's tool scope: the main scope narrowed by its plugin's
 * lists for it (Claude Code's plugin subagents), then `Agent` denied.
 */
export function pluginSubagentScope(
  mainScope: ToolScope,
  agent: { readonly name: string; readonly tools: readonly string[]; readonly disallowedTools: readonly string[] },
): ToolScope {
  return mainScope
    .narrow(`Subagent "${agent.name}"`, { tools: [...agent.tools], disallowedTools: [...agent.disallowedTools] })
    .narrow(ONE_LEVEL_LAYER.owner, ONE_LEVEL_LAYER.lists);
}

/**
 * The model a subagent runs on: `model` when it was chosen for this
 * conversation's engine (`chosenFor`, an agent's `harness`; unset is the
 * native engine, as everywhere) and that engine's registry section lists
 * it by id; otherwise undefined, the turn's model. A plugin subagent's
 * file names no engine, so its model counts on whichever engine lists it.
 */
export async function subagentModel(
  model: string,
  engine: Exclude<Harness, Harness.UNSPECIFIED>,
  chosenFor?: Harness,
): Promise<string | undefined> {
  const name = model.trim();
  if (name === "" || name === "inherit") return undefined;
  if (chosenFor !== undefined && (chosenFor === Harness.UNSPECIFIED ? Harness.NATIVE : chosenFor) !== engine) {
    return undefined;
  }
  return (await isModelListedFor(name, registrySectionOf(engine))) ? name : undefined;
}

/** The model registry's section for an engine: each engine lists its own models. */
function registrySectionOf(engine: Exclude<Harness, Harness.UNSPECIFIED>): RegistryHarness {
  switch (engine) {
    case Harness.NATIVE:
      return "native";
    case Harness.CURSOR:
      return "cursor";
    case Harness.CLAUDE:
      return "claude";
    default: {
      const unknown: never = engine;
      throw new Error(`subagent model: harness ${String(unknown)} names no engine`);
    }
  }
}
