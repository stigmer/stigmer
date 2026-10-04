/**
 * A plugin agent's Claude tool lists, rewritten to the names the installed
 * plugin's tools carry on Stigmer and checked against the contract.
 *
 * Claude names a plugin's own MCP tools `mcp__plugin_<plugin>_<server>__<tool>`,
 * each name with every character outside `A-Za-z0-9_-` replaced by `_`;
 * Stigmer names them by the materialised server's slug, `mcp__<slug>__<tool>`.
 * So each of this plugin's servers has its Claude prefix built from the
 * plugin and server names (built, never parsed, since either name may hold
 * `_`) and matched exactly, followed by the end or `__`: the whole server,
 * `__*` and `__<tool>` all become the slug's form. A plugin agent's type in
 * `Agent(...)` or `Task(...)`, scoped as `<plugin>:<agent>`, becomes the bare
 * name the materialised sub-agent carries, when it names one of this
 * plugin's agents.
 *
 * Each entry is then checked by the server's shared validator, the engine
 * that would refuse the agent at apply, on a one-entry `SubAgent` probe that
 * is otherwise valid, so the rule has one home (the proto) and runs with its
 * own regular-expression flavour. An entry that fails is dropped and named,
 * which is what the runner does at run time to a name that resolves to no
 * tool. Names the contract accepts but Stigmer lacks (`LS`, `TaskCreate`)
 * are kept for the runner to ignore per entry. A non-empty `tools` list
 * that loses every entry is reported, never stored empty: an empty list
 * means every tool, which would widen an agent its author narrowed.
 *
 * Hook matchers and `if` conditions are not rewritten here: a hook's script
 * reads the tool name too, so the runner shows hooks Claude's names instead.
 */
import { create } from "@bufbuild/protobuf";

import type { PluginMcpServer } from "@stigmer/plugin-package";
import { SubAgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";

import { validator } from "../../../pipeline/steps/validation.js";
import { mcpServerSlugOf } from "./mcp-servers.js";

export type ToolListField = "tools" | "disallowedTools";

/** What the rewrite needs to know about the plugin. */
export interface ToolListScope {
  readonly pluginName: string;
  readonly servers: readonly PluginMcpServer[];
  readonly agentNames: ReadonlySet<string>;
}

export interface CheckedToolList {
  /** The entries kept, rewritten. */
  readonly entries: readonly string[];
  /** The entries dropped, as rewritten. */
  readonly dropped: readonly string[];
  /** True when a non-empty list lost every entry. */
  readonly emptied: boolean;
}

/** A sub-agent whose `tools` list emptied, or the main agent refusing the install for it. */
export class ToolListEmptiedError extends Error {
  constructor(agent: string, dropped: readonly string[]) {
    super(
      `main agent '${agent}' keeps none of the tools its 'tools' list names (${dropped
        .map((entry) => `'${entry}'`)
        .join(
          ", ",
        )}); an agent whose list empties would get every tool, so the plugin is not installed`,
    );
    this.name = "ToolListEmptiedError";
  }
}

/** Claude's rule for the names inside a plugin tool's prefix. */
function claudeNamePart(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_");
}

/** Rewrite one list and check each entry. */
export function checkToolList(
  entries: readonly string[],
  field: ToolListField,
  scope: ToolListScope,
): CheckedToolList {
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const entry of entries) {
    const rewritten = rewriteToolListEntry(entry, scope);
    if (isStorableEntry(rewritten, field)) kept.push(rewritten);
    else dropped.push(rewritten);
  }
  return {
    entries: kept,
    dropped,
    emptied: entries.length > 0 && kept.length === 0,
  };
}

/** One entry with this plugin's own server prefixes and agent types in Stigmer's names. */
export function rewriteToolListEntry(
  entry: string,
  scope: ToolListScope,
): string {
  const plugin = claudeNamePart(scope.pluginName);
  for (const server of scope.servers) {
    const prefix = `mcp__plugin_${plugin}_${claudeNamePart(server.name)}`;
    if (entry === prefix || entry.startsWith(`${prefix}__`)) {
      return `mcp__${mcpServerSlugOf(server)}${entry.slice(prefix.length)}`;
    }
  }
  const call = /^(Agent|Task)\((.*)\)$/s.exec(entry);
  if (call !== null) {
    const [, tool, specifier] = call;
    const scoped = `${scope.pluginName}:`;
    let changed = false;
    const types = (specifier ?? "").split(",").map((type) => {
      const trimmed = type.trim();
      const bare = trimmed.slice(scoped.length);
      if (!trimmed.startsWith(scoped) || !scope.agentNames.has(bare))
        return trimmed;
      changed = true;
      return bare;
    });
    // An entry naming none of this plugin's agents is kept byte for byte.
    return changed ? `${tool}(${types.join(", ")})` : entry;
  }
  return entry;
}

/** True when the contract would store the entry in `field`. */
export function isStorableEntry(entry: string, field: ToolListField): boolean {
  const probe = create(SubAgentSchema, {
    name: "probe",
    instructions: "probe instructions",
    [field]: [entry],
  });
  return validator().validate(SubAgentSchema, probe).kind === "valid";
}
