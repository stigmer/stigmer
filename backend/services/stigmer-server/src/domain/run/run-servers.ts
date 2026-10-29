/**
 * Every MCP server a run's turns dial, each with its home: the servers the
 * run's agent writes itself, each subagent's own, then every plugin's. One
 * gathering, so the values planning reads every server the runner will
 * start, whoever holds it, and says whose each one is.
 *
 * A server's home is the saved resource it is part of, at the version the
 * run planned: a plugin at the archive it resolved to, or an agent at the
 * version the run (or the parent's pin, for a subagent) recorded. The
 * values fetch reads the server again at that version, so a login is
 * checked against the address the run planned, never a later edit.
 *
 * A turn names a server by one name: an agent's own server by the name its
 * agent gave it (`mcp__<name>__<tool>`), a plugin's as Claude Code does
 * (`plugin_<plugin>_<server>`). The two forms never meet (an agent's name
 * holds no `_`), and plugins refuse their own clashes when they are loaded
 * (run-plugins.ts), so what is left to refuse here is two agents of the
 * run, the agent and a subagent or two subagents, writing a server of one
 * name: the turn would hold one of them under it. The run is refused
 * naming both, as two plugins' clash is.
 *
 * A header value read from an agent's own `env` declaration takes that
 * declaration; a platform variable (the caller, the conversation, the
 * Stigmer server's address) is optional and no secret, as the plugin
 * reader declares it for a plugin's server; any other name is a required
 * secret (the planner's default for an undeclared name).
 *
 * Tests: __tests__/run-servers.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import { PLATFORM_VARIABLES, toolServerSegment } from "@stigmer/plugin-package";

import type { AgentSpec } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import type { McpServerEntry } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import { EnvVarDeclarationSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/declaration_pb";
import type { EnvVarDeclaration } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/declaration_pb";

import { failedPreconditionError } from "../../pipeline/errors.js";
import { agentServerEntry } from "../vault/agent-servers.js";
import type { RunPlugin } from "../vault/resolve.js";
import type { RunSubagent } from "./run-subagents.js";

/** The saved resource an MCP server is part of, at the version the run planned. */
export type ServerHome =
  | {
      readonly kind: "plugin";
      readonly pluginId: string;
      readonly pluginName: string;
      /** The plugin's archive, at the version the run resolved. */
      readonly pluginDigest: string;
    }
  | {
      readonly kind: "agent";
      readonly agentId: string;
      readonly agentName: string;
      /** The agent's version hash the run planned. */
      readonly agentVersion: string;
    };

/** One MCP server of a run, with its home's declarations of the keys it reads. */
export interface RunServer {
  readonly home: ServerHome;
  readonly entry: McpServerEntry;
  readonly env: { readonly [key: string]: EnvVarDeclaration };
}

/** An agent of the run, at the version the run planned. */
export interface RunAgentHome {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly spec: AgentSpec;
}

/** Each MCP server of a plugin. */
export function serversOf(plugin: RunPlugin): RunServer[] {
  return plugin.status.mcpServers.map((entry) => ({
    home: { kind: "plugin", pluginId: plugin.id, pluginName: plugin.name, pluginDigest: plugin.status.digest },
    entry,
    env: plugin.status.env,
  }));
}

/** The declaration of each key `entry` reads that is not a required secret: the agent's own, or a platform variable's. */
function agentServerDeclarations(
  entry: McpServerEntry,
  agentEnv: { readonly [key: string]: EnvVarDeclaration },
): Record<string, EnvVarDeclaration> {
  const env: Record<string, EnvVarDeclaration> = {};
  for (const name of entry.env) {
    const declared = agentEnv[name];
    if (declared !== undefined) {
      env[name] = declared;
    } else if (PLATFORM_VARIABLES.has(name)) {
      env[name] = create(EnvVarDeclarationSchema, { isSecret: false, optional: true });
    }
  }
  return env;
}

/** Each MCP server an agent writes itself. */
export function agentServersOf(agent: RunAgentHome): RunServer[] {
  return agent.spec.mcpServers.map((server) => {
    const entry = agentServerEntry(server);
    return {
      home: { kind: "agent", agentId: agent.id, agentName: agent.name, agentVersion: agent.version },
      entry,
      env: agentServerDeclarations(entry, agent.spec.env),
    };
  });
}

/** The name a turn gives a server. */
export function turnServerName(server: RunServer): string {
  switch (server.home.kind) {
    case "plugin":
      return toolServerSegment(server.home.pluginName, server.entry.name);
    case "agent":
      return server.entry.name;
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const unreachable: never = server.home;
      return unreachable;
    }
  }
}

/** What `runServers` reads: the run's agent (none for a run with no agent), its subagents, its plugins. */
export interface RunServersInput {
  readonly agent: RunAgentHome | undefined;
  readonly subagents: readonly RunSubagent[];
  readonly plugins: readonly RunPlugin[];
}

/**
 * Every MCP server of the run: the agent's own, each subagent's own, then
 * each plugin's. Refuses two agents of the run writing a server of one name.
 */
export function runServers(input: RunServersInput): RunServer[] {
  const agents: RunAgentHome[] = [
    ...(input.agent === undefined ? [] : [input.agent]),
    ...input.subagents.map((subagent) => ({
      id: subagent.id,
      name: subagent.name,
      version: subagent.versionHash,
      spec: subagent.spec,
    })),
  ];
  const written = new Map<string, string>();
  for (const agent of agents) {
    for (const server of agent.spec.mcpServers) {
      const holder = written.get(server.name);
      if (holder !== undefined) {
        throw failedPreconditionError(
          `this conversation uses two MCP servers a turn would both name '${server.name}' (agent '${holder}' server '${server.name}' and ` +
            `agent '${agent.name}' server '${server.name}'); rename one of them in its agent, or remove the subagent from the agent`,
        );
      }
      written.set(server.name, agent.name);
    }
  }
  return [...agents.flatMap(agentServersOf), ...input.plugins.flatMap(serversOf)];
}
