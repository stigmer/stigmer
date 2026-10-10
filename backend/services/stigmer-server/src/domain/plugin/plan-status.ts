/**
 * What a plugin's status says its archive holds, planned from the library's
 * reading of the package before anything is written. One pure function
 * turns the `PluginPackage` into the status lists (skills, agents, MCP
 * server entries, the variables they read, the hooks) plus the warnings the
 * plan itself raised; install then stores the plugin once with them.
 * Nothing else is created: a turn that lists the plugin gets every part of
 * it, named under the plugin.
 *
 * The three judgements install makes about a plugin's agents:
 *   - each tool list is checked by the contract's own validator, entry by
 *     entry: an entry the contract cannot store is dropped with a warning,
 *     which is what the runner does at run time to a name that resolves to
 *     no tool, and an agent whose `tools` list loses every entry is left
 *     out with a warning (an empty list means every tool, which would widen
 *     an agent its author narrowed). Entries keep Claude Code's names: a
 *     plugin's own server is `mcp__plugin_<plugin>_<server>`, and a plugin
 *     agent is `<plugin>:<agent>`, the names a turn gives them;
 *   - a model the file names is recorded as a warning and not applied:
 *     the agent runs on the turn's model;
 *   - the plugin skills an agent's `skills:` names are kept when the plugin
 *     carries them (an unknown name already carries the library's warning).
 * A Claude plugin's settings may name one of its agents as the main
 * agent; on Stigmer the conversation's own agent runs the main thread, so
 * that agent is an ordinary plugin agent and a warning says so.
 *
 * A server's tools are named `mcp__plugin_<plugin>_<server>__<tool>`, as
 * Claude Code names them, each name with every character outside
 * `A-Za-z0-9_-` written as `_` (`toolServerSegment`). The segment is built
 * and compared whole, never split, so a plugin or server name holding `_`
 * is fine; one whose segment would hold `__` or end in `_` could never be
 * told apart from a tool name, and refuses the install.
 *
 * `env` holds every variable a server or a hook reads: the plugin's own
 * declarations, a required secret for a name it reads but does not
 * declare, and the names the runner fills itself (the library declares
 * those optional). A server at an address that signs in gets its login key
 * added after the probe (`probe-sign-in.ts`).
 *
 * Tests: __tests__/plan-status.test.ts.
 */
import { create } from "@bufbuild/protobuf";

import { hookVariableReferences, toolServerSegment } from "@stigmer/plugin-package";
import type { PluginHooks, PluginPackage, PluginSubAgent } from "@stigmer/plugin-package";
import { SubAgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import {
  HttpMcpServerSchema,
  McpServerEntrySchema,
  PluginAgentSchema,
  PluginSkillSchema,
  PluginWarningSchema,
  StdioMcpServerSchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import type {
  McpServerEntry,
  PluginAgent,
  PluginSkill,
  PluginWarning,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";
import type { EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";

import { validator } from "../../pipeline/steps/validation.js";
import { SERVER_WARNING_KINDS, VERSION_TAG_PATTERN } from "./constants.js";

/** Everything install records about the archive, before the sign-in probe. */
export interface PluginStatusPlan {
  readonly skills: readonly PluginSkill[];
  readonly agents: readonly PluginAgent[];
  readonly mcpServers: readonly McpServerEntry[];
  readonly env: Readonly<Record<string, EnvVarDeclaration>>;
  /** The tool-call hooks read, for `PluginStatus.hooks`; absent when there are none. */
  readonly hooks: PluginHooks | undefined;
  /** The audit tag this push assigns; empty when the version does not fit. */
  readonly tag: string;
  readonly warnings: readonly PluginWarning[];
}

/** A server whose tool names could not be told apart, phrased for the author. */
export class ServerNameError extends Error {
  constructor(plugin: string, server: string, segment: string) {
    super(
      `MCP server '${server}' of plugin '${plugin}' would name its tools 'mcp__${segment}__<tool>', ` +
        "which cannot be told apart from a tool name (two underscores in a row, or one at the end); rename the plugin or the server",
    );
    this.name = "ServerNameError";
  }
}

export type ToolListField = "tools" | "disallowedTools";

/** The manifest version as a tag, or empty with a warning when it cannot be one. */
export function versionTag(
  version: string | undefined,
  warnings: PluginWarning[],
): string {
  if (version === undefined || version === "") {
    return "";
  }
  if (VERSION_TAG_PATTERN.test(version)) {
    return version;
  }
  warnings.push(
    create(PluginWarningSchema, {
      kind: SERVER_WARNING_KINDS.versionNotTaggable,
      message:
        `version '${version}' cannot be a tag (letters, digits, '.', '_' and '-' only); ` +
        "this version is reachable by its digest but not by name",
    }),
  );
  return "";
}

export function planPluginStatus(plugin: PluginPackage): PluginStatusPlan {
  const warnings: PluginWarning[] = [];
  for (const ignored of plugin.ignored) {
    warnings.push(
      create(PluginWarningSchema, {
        kind: SERVER_WARNING_KINDS.componentIgnored,
        path: ignored.path,
        message: `${ignored.kind} at '${ignored.path}' is not installed; Stigmer reads skills, agents, MCP servers, hooks and a Claude plugin's settings`,
      }),
    );
  }
  const tag = versionTag(plugin.version, warnings);

  for (const server of plugin.mcpServers) {
    const segment = toolServerSegment(plugin.name, server.name);
    if (segment.includes("__") || segment.endsWith("_")) {
      throw new ServerNameError(plugin.name, server.name, segment);
    }
  }

  const skillNames = new Set(plugin.skills.map((skill) => skill.name));
  if (plugin.mainAgent !== undefined) {
    const main = plugin.subAgents.find((agent) => agent.name === plugin.mainAgent);
    warnings.push(
      create(PluginWarningSchema, {
        kind: SERVER_WARNING_KINDS.settingsAgentNotApplied,
        path: main?.path ?? "",
        message:
          `the plugin's settings name '${plugin.mainAgent}' as the main agent; on Stigmer a conversation's own agent runs the main thread, ` +
          `so '${plugin.name}:${plugin.mainAgent}' is one of the plugin's agents`,
      }),
    );
  }

  return {
    skills: plugin.skills.map((skill) =>
      create(PluginSkillSchema, {
        name: skill.name,
        description: skill.description ?? "",
        path: skill.dir,
      }),
    ),
    agents: plugin.subAgents.flatMap((agent) => {
      const planned = planAgent(agent, plugin.name, skillNames, warnings);
      return planned === undefined ? [] : [planned];
    }),
    mcpServers: plugin.mcpServers.map((server) => {
      const entry = create(McpServerEntrySchema, {
        name: server.name,
        env: [...server.env],
      });
      switch (server.transport) {
        case "http":
          entry.transport = {
            case: "http",
            value: create(HttpMcpServerSchema, {
              url: server.url,
              headers: { ...server.headers },
            }),
          };
          break;
        case "stdio":
          entry.transport = {
            case: "stdio",
            value: create(StdioMcpServerSchema, {
              command: server.command,
              args: [...server.args],
            }),
          };
          break;
        default: {
          const exhaustive: never = server;
          throw new Error(`unknown transport ${JSON.stringify(exhaustive)}`);
        }
      }
      return entry;
    }),
    env: variablesRead(plugin),
    hooks: plugin.hooks,
    tag,
    warnings,
  };
}

/**
 * Every variable a server or a hook of the plugin reads, as the plugin
 * declared it, or as a required secret when it did not. A declared
 * variable nothing reads is left out (the library already warned).
 */
export function variablesRead(
  plugin: PluginPackage,
): Record<string, EnvVarDeclaration> {
  const declared = new Map(
    plugin.variables.map((variable) => [
      variable.name,
      create(EnvVarDeclarationSchema, {
        isSecret: variable.isSecret,
        description: variable.description ?? "",
        optional: variable.optional,
      }),
    ]),
  );
  const read = [
    ...plugin.mcpServers.flatMap((server) => server.env),
    ...(plugin.hooks === undefined ? [] : hookVariableReferences(plugin.hooks)),
  ];
  const env: Record<string, EnvVarDeclaration> = {};
  for (const name of read) {
    env[name] ??= declared.get(name) ?? requiredSecret();
  }
  return env;
}

/**
 * A name the library did not declare cannot reach here for a server (it
 * infers every undeclared server reference); a hook's undeclared name can,
 * and is a required secret, as the library declares a server's.
 */
function requiredSecret(): EnvVarDeclaration {
  return create(EnvVarDeclarationSchema, { isSecret: true, optional: false });
}

function planAgent(
  agent: PluginSubAgent,
  pluginName: string,
  skillNames: ReadonlySet<string>,
  warnings: PluginWarning[],
): PluginAgent | undefined {
  const check = (field: ToolListField): readonly string[] => {
    const kept: string[] = [];
    for (const entry of agent[field] ?? []) {
      if (isStorableEntry(entry, field)) {
        kept.push(entry);
        continue;
      }
      warnings.push(
        create(PluginWarningSchema, {
          kind: SERVER_WARNING_KINDS.toolListEntryDropped,
          path: agent.path,
          message:
            `agent '${agent.name}' lists '${entry}' in '${field}', which is not a tool name Stigmer can store; ` +
            "the entry is dropped",
        }),
      );
    }
    return kept;
  };
  const tools = check("tools");
  const disallowedTools = check("disallowedTools");
  if ((agent.tools ?? []).length > 0 && tools.length === 0) {
    warnings.push(
      create(PluginWarningSchema, {
        kind: SERVER_WARNING_KINDS.agentNotInstalled,
        path: agent.path,
        message:
          `agent '${pluginName}:${agent.name}' is left out: every entry of its 'tools' list was dropped, ` +
          "and an empty list would give it every tool",
      }),
    );
    return undefined;
  }
  warnModelHint(agent, warnings);
  return create(PluginAgentSchema, {
    name: agent.name,
    description: agent.description ?? "",
    instructions: agent.instructions,
    tools: [...tools],
    disallowedTools: [...disallowedTools],
    // An unknown skill name already carries the library's own warning.
    skills: agent.skillNames.filter((name) => skillNames.has(name)),
  });
}

function warnModelHint(agent: PluginSubAgent, warnings: PluginWarning[]): void {
  const hint = agent.modelHint;
  if (
    hint !== undefined &&
    hint.alias !== "inherit" &&
    hint.alias !== "unknown"
  ) {
    // An unknown alias already carries the library's own sentence.
    warnings.push(
      create(PluginWarningSchema, {
        kind: SERVER_WARNING_KINDS.modelHintUnresolved,
        path: agent.path,
        message:
          `agent '${agent.name}' names model '${hint.raw}'; Stigmer does not pin a model ` +
          "from a plugin, so it runs on the conversation's model",
      }),
    );
  }
}

/**
 * True when the contract would store the entry in `field`: the server's
 * shared validator on a one-entry `SubAgent` probe that is otherwise
 * valid, so the rule has one home (the proto) and runs with its own
 * regular-expression flavour.
 */
export function isStorableEntry(entry: string, field: ToolListField): boolean {
  const probe = create(SubAgentSchema, {
    name: "probe",
    instructions: "probe instructions",
    [field]: [entry],
  });
  return validator().validate(SubAgentSchema, probe).kind === "valid";
}
