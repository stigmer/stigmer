/**
 * Every MCP server a run of an agent dials, read the way the run reads it,
 * so the console asks the person starting a conversation for what the run
 * would refuse without, and for nothing else. The console's twin of the
 * server's run planning: `domain/run/run-subagents.ts` (which agents),
 * `domain/run/run-servers.ts` (which servers, and each home's
 * declarations), `domain/run/run-plugins.ts` (`runPluginReferences`) and
 * the requirement half of `domain/vault/resolve.ts` (`declarationsOf`,
 * `toolRequirements`, `runRequirements`) in
 * `backend/services/stigmer-server`. No test spans the two packages, so a
 * change to either side's rule changes the other in the same change.
 *
 * A run's agents are the agent and each subagent it lists, read at the
 * version the agent pinned (`spec.subagents`; one level, which the save
 * enforces). A subagent another person cannot view, or one since deleted,
 * cannot be told apart by `getVersion`, and the server reads it from its
 * store whoever runs it, so one whose read fails is left out: its keys go
 * unasked and the run says what it lacks at its first turn.
 *
 * A server has a home: an agent of the run that writes it
 * (`spec.mcp_servers`) or a plugin one of them lists. As a run gathers
 * them: the agent's own servers, then each subagent's own, then the
 * plugins, the agent's first and then each subagent's not already listed
 * (a subagent's reference with no organization names its own
 * organization's plugin). An agent's server is read as the plugin server
 * entry every reader already takes (`agentServerEntry`): HTTP at its URL,
 * its `env` the `${NAME}`s its headers read, scanned with the runner's own
 * pattern. Its home's declaration of a name is the agent's `env` entry,
 * else a platform variable's (optional, no secret), as the plugin reader
 * declares one for a plugin. A plugin's is its `status.env`, and its hooks
 * read names too (`hookVariableReferences`).
 *
 * One rule over every home then: a name the runner always fills
 * (`RUNNER_FILLED_VARIABLES`: who is calling, the conversation) is no
 * requirement and nobody is asked for it; any other name takes its home's
 * declaration, else it is a required secret.
 *
 * Each agent of the run declares keys of its own (`spec.env`). A key any
 * server or hook of the run reads is that tool's, and an agent's own
 * declaration of it is dropped, the parent's included (`runRequirements`).
 *
 * The run matches each declarer on its own, so the composer asks once for
 * a key several declare, with the declaration that asks the most of the
 * person (`strongerDeclaration`): one that needs a value (a secret, or a
 * setting with no value of its own) over one that fills itself, then a
 * required one over an optional one, then the first seen; and secret when
 * any of them is, so a value one declarer keeps secret is never typed in
 * clear.
 *
 * Logins. A plugin's server with a sign-in record is filled by a login at
 * its address; its login key is never typed (`signInKeys`). Any HTTP
 * server's `Authorization: Bearer ${NAME}` is filled by a login at its
 * address or by a secret of that name, which `keysHeldBy` in the setup
 * hook counts. An agent's server that sends no `Authorization` takes an
 * optional login at its address (the run's `<SERVER>_ACCESS_TOKEN`);
 * nothing reads that name but the runner, so it is never declared here
 * and never asked for.
 *
 * Pinned by `__tests__/runServers.test.ts`.
 */

import { create } from "@bufbuild/protobuf";
import type { Stigmer, ResourceRef } from "@stigmer/client";
import type { AgentMcpServer, AgentSpec } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import type { ApiResourceReference } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import type { Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { McpServerEntrySchema, type McpServerEntry } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import {
  EnvVarDeclarationSchema,
  type EnvVarDeclaration,
} from "@stigmer/apis/ai/stigmer/agentic/vault/v1/declaration_pb";
import {
  hookVariableReferences,
  PLACEHOLDER_PATTERN,
  PLATFORM_VARIABLES,
  RUNNER_FILLED_VARIABLES,
} from "@stigmer/plugin-package";
import { toolAddressOf, toolLoginKeyOf } from "../vault/address.js";

/** Where a server is written: the agent itself, or a plugin it lists. */
export type ServerHome =
  | {
      readonly kind: "plugin";
      /** The plugin, by the reference the agent lists it with (organization filled). */
      readonly ref: ResourceRef;
      readonly pluginName: string;
    }
  | { readonly kind: "agent" };

/** One MCP server of a run, with its home's declarations of the names it reads. */
export interface ServerReading {
  readonly home: ServerHome;
  readonly entry: McpServerEntry;
  readonly env: Readonly<Record<string, EnvVarDeclaration>>;
}

/** The names one plugin's hooks read, with the plugin's declarations. */
export interface HookReading {
  readonly names: readonly string[];
  readonly env: Readonly<Record<string, EnvVarDeclaration>>;
}

/** What a run of the agent dials and runs: every server, and every plugin's hooks. */
export interface RunServersReading {
  readonly servers: readonly ServerReading[];
  readonly hooks: readonly HookReading[];
}

/** One agent of a run, by the keys it declares of its own. */
export interface RunAgentReading {
  readonly env: Readonly<Record<string, EnvVarDeclaration>>;
}

/** A whole run: its servers and hooks, and each of its agents (the agent, then each subagent read). */
export interface RunReading extends RunServersReading {
  readonly agents: readonly RunAgentReading[];
}

/** A server among the plugins that signs in, with the address its login is saved at. */
export interface SignInServer {
  /** The plugin, by the reference the agent lists it with (organization filled). */
  readonly plugin: ResourceRef;
  readonly pluginName: string;
  readonly server: McpServerEntry;
  readonly address: string;
}

/** The names `headers`' values read, sorted, each once. */
function headerReferences(headers: Readonly<Record<string, string>>): string[] {
  const names = new Set<string>();
  for (const value of Object.values(headers)) {
    for (const match of value.matchAll(PLACEHOLDER_PATTERN)) {
      const name = match[1];
      if (name !== undefined) names.add(name);
    }
  }
  return [...names].sort();
}

/** `server` as a plugin server entry: HTTP, its URL and headers, the run values its headers read. */
export function agentServerEntry(server: Pick<AgentMcpServer, "name" | "url" | "headers">): McpServerEntry {
  return create(McpServerEntrySchema, {
    name: server.name,
    transport: { case: "http", value: { url: server.url, headers: { ...server.headers } } },
    env: headerReferences(server.headers),
  });
}

/** The declaration of each name `entry` reads that is not a required secret: the agent's own, or a platform variable's. */
function agentServerDeclarations(
  entry: McpServerEntry,
  agentEnv: Readonly<Record<string, EnvVarDeclaration>>,
): Record<string, EnvVarDeclaration> {
  const env: Record<string, EnvVarDeclaration> = {};
  for (const name of entry.env) {
    const declared = Object.hasOwn(agentEnv, name) ? agentEnv[name] : undefined;
    if (declared !== undefined) {
      env[name] = declared;
    } else if (PLATFORM_VARIABLES.has(name)) {
      env[name] = create(EnvVarDeclarationSchema, { isSecret: false, optional: true });
    }
  }
  return env;
}

/**
 * Each MCP server the agent writes itself. A spec read from a stored
 * version may carry neither list, so each absent one reads as empty.
 */
export function agentServerReadings(spec: Pick<AgentSpec, "mcpServers" | "env">): ServerReading[] {
  return (spec.mcpServers ?? []).map((server) => {
    const entry = agentServerEntry(server);
    return { home: { kind: "agent" }, entry, env: agentServerDeclarations(entry, spec.env ?? {}) };
  });
}

/** Each MCP server and the hooks of a plugin, read at `ref`. */
export function pluginReadings(ref: ResourceRef, plugin: Plugin): RunServersReading {
  const status = plugin.status;
  if (status === undefined) return { servers: [], hooks: [] };
  const home: ServerHome = { kind: "plugin", ref, pluginName: plugin.metadata?.name || ref.slug };
  return {
    servers: status.mcpServers.map((entry) => ({ home, entry, env: status.env })),
    hooks: status.hooks !== undefined ? [{ names: hookVariableReferences(status.hooks), env: status.env }] : [],
  };
}

/** Whether a reference names anything: a run skips one with neither id nor slug. */
function named(ref: Pick<ApiResourceReference, "id" | "slug">): boolean {
  return ref.id !== "" || ref.slug !== "";
}

/**
 * The organization of each subagent `spec` lists: the reference's, else
 * `defaultOrg`. Read from the references alone, so a caller judges whose
 * agents a run carries without reading any.
 */
export function subagentOrgs(spec: Pick<AgentSpec, "subagents"> | undefined, defaultOrg: string): string[] {
  return (spec?.subagents ?? []).filter(named).map((ref) => ref.org || defaultOrg);
}

/** Each subagent `spec` lists that can be read, at its pinned version, in the order listed. */
async function readSubagents(
  stigmer: Pick<Stigmer, "agent">,
  spec: Pick<AgentSpec, "subagents">,
  defaultOrg: string,
): Promise<{ readonly org: string; readonly spec: AgentSpec }[]> {
  const read = await Promise.all(
    (spec.subagents ?? []).filter(named).map(async (ref) => {
      try {
        const version = await stigmer.agent.getVersion({ agentId: ref.id, versionHash: ref.version });
        return version.specSnapshot === undefined ? null : { org: ref.org || defaultOrg, spec: version.specSnapshot };
      } catch {
        // Unreadable: left out, as the module header says.
        return null;
      }
    }),
  );
  return read.filter((subagent) => subagent !== null);
}

/** Options for {@link readAgentServers}. */
export interface ReadAgentServersOptions {
  /**
   * What a plugin that cannot be read does: `"throw"` fails the reading,
   * as it would refuse the run; `"skip"` leaves it out, for a reader that
   * names what it knows and lets the run refuse the rest.
   */
  readonly plugins: "throw" | "skip";
}

/**
 * Every agent, server and plugin hook of a run of the agent at `spec`:
 * the subagents it lists, read at their pinned versions; the agent's own
 * servers, then each subagent's; then each plugin's, read by reference
 * (the reference's organization, else `defaultOrg` for the agent's and
 * the subagent's own for a subagent's), each plugin once.
 */
export async function readAgentServers(
  stigmer: Pick<Stigmer, "plugin" | "agent">,
  spec: Pick<AgentSpec, "mcpServers" | "env" | "plugins" | "subagents">,
  defaultOrg: string,
  options: ReadAgentServersOptions,
): Promise<RunReading> {
  const subagents = await readSubagents(stigmer, spec, defaultOrg);
  const servers: ServerReading[] = [
    ...agentServerReadings(spec),
    ...subagents.flatMap((subagent) => agentServerReadings(subagent.spec)),
  ];
  const hooks: HookReading[] = [];
  const refs: ResourceRef[] = (spec.plugins ?? []).map((listed) => ({ org: listed.org || defaultOrg, slug: listed.slug }));
  const listedKeys = new Set(refs.map((ref) => `${ref.org}/${ref.slug}`));
  for (const subagent of subagents) {
    for (const listed of subagent.spec.plugins ?? []) {
      const ref = { org: listed.org || subagent.org, slug: listed.slug };
      const key = `${ref.org}/${ref.slug}`;
      if (!named(listed) || listedKeys.has(key)) continue;
      listedKeys.add(key);
      refs.push(ref);
    }
  }
  for (const ref of refs) {
    let plugin: Plugin;
    try {
      plugin = await stigmer.plugin.getByReference(ref);
    } catch (err) {
      if (options.plugins === "throw") throw err;
      continue;
    }
    const read = pluginReadings(ref, plugin);
    servers.push(...read.servers);
    hooks.push(...read.hooks);
  }
  const agents = [spec, ...subagents.map((subagent) => subagent.spec)].map((agent) => ({ env: agent.env ?? {} }));
  return { servers, hooks, agents };
}

/** Whether a declaration asks the person for a value: a secret, or a setting with no value of its own. */
function needsValue(declaration: EnvVarDeclaration): boolean {
  return declaration.isSecret || (declaration.value ?? "") === "";
}

/**
 * Of two declarations of one key, the one the composer asks with: one
 * that needs a value over one that fills itself, then a required one
 * over an optional one, then `seen`; secret when either is.
 */
export function strongerDeclaration(seen: EnvVarDeclaration, next: EnvVarDeclaration): EnvVarDeclaration {
  let kept = seen;
  if (needsValue(seen) !== needsValue(next)) {
    kept = needsValue(next) ? next : seen;
  } else if (seen.optional && !next.optional) {
    kept = next;
  }
  const isSecret = seen.isSecret || next.isSecret;
  if (kept.isSecret === isSecret) return kept;
  return create(EnvVarDeclarationSchema, { isSecret, description: kept.description, optional: kept.optional });
}

/** Sets `name`'s declaration in `declarations`, merged with any already there. */
function declareOnce(declarations: Record<string, EnvVarDeclaration>, name: string, declared: EnvVarDeclaration): void {
  const seen = Object.hasOwn(declarations, name) ? declarations[name] : undefined;
  const value = seen === undefined ? declared : strongerDeclaration(seen, declared);
  // Defined, not assigned: a name read from a plugin or an agent may be `__proto__`.
  Object.defineProperty(declarations, name, { value, enumerable: true, writable: true, configurable: true });
}

/**
 * Every name the run's servers and hooks read, with its declaration: its
 * home's, else a required secret. A name the runner always fills is none.
 * A name read twice takes {@link strongerDeclaration}'s answer.
 */
export function declarationsOf(reading: RunServersReading): Record<string, EnvVarDeclaration> {
  const declarations: Record<string, EnvVarDeclaration> = {};
  const declare = (names: readonly string[], env: Readonly<Record<string, EnvVarDeclaration>>) => {
    for (const name of names) {
      if (RUNNER_FILLED_VARIABLES.has(name)) continue;
      const declared =
        (Object.hasOwn(env, name) ? env[name] : undefined) ?? create(EnvVarDeclarationSchema, { isSecret: true, optional: false });
      declareOnce(declarations, name, declared);
    }
  };
  for (const server of reading.servers) declare(server.entry.env, server.env);
  for (const hook of reading.hooks) declare(hook.names, hook.env);
  return declarations;
}

/**
 * Every key the run asks for, with its declaration: the servers' and
 * hooks' ({@link declarationsOf}), then each agent's own `env` (the
 * agent's, then each subagent's) for a key no server or hook reads. An
 * agent's declaration of a key a tool reads is the tool's, as the run
 * counts it; several agents declaring one key take
 * {@link strongerDeclaration}'s answer.
 */
export function runDeclarations(reading: RunReading): Record<string, EnvVarDeclaration> {
  const declarations = declarationsOf(reading);
  const toolKeys = new Set(Object.keys(declarations));
  for (const agent of reading.agents) {
    for (const [name, declared] of Object.entries(agent.env)) {
      if (!toolKeys.has(name)) declareOnce(declarations, name, declared);
    }
  }
  return declarations;
}

/** The HTTP servers among the plugins that sign in, one per address, named by the first plugin to list it. */
export function signInServers(reading: RunServersReading): SignInServer[] {
  const byAddress = new Map<string, SignInServer>();
  for (const { home, entry } of reading.servers) {
    if (home.kind !== "plugin" || entry.transport.case !== "http" || entry.signIn === undefined) continue;
    const address = toolAddressOf(entry);
    if (address === null || byAddress.has(address)) continue;
    byAddress.set(address, { plugin: home.ref, pluginName: home.pluginName, server: entry, address });
  }
  return [...byAddress.values()];
}

/** The login key of every server that signs in: filled by a sign-in, never typed. */
export function signInKeys(reading: RunServersReading): Set<string> {
  const keys = new Set<string>();
  for (const { entry } of reading.servers) {
    if (entry.signIn === undefined) continue;
    const key = toolLoginKeyOf(entry);
    if (key !== null) keys.add(key);
  }
  return keys;
}

/** Every server of the run, for matching the logins a vault holds. */
export function serversOf(reading: RunServersReading): McpServerEntry[] {
  return reading.servers.map((server) => server.entry);
}

/** Whether a run of the agent dials any MCP server: it lists a plugin, or writes a server of its own. */
export function agentUsesTools(spec: Pick<AgentSpec, "plugins" | "mcpServers"> | undefined): boolean {
  return (spec?.plugins?.length ?? 0) > 0 || (spec?.mcpServers?.length ?? 0) > 0;
}
