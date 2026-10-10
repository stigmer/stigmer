// `connect plugin` orchestration: resolve the plugin, pick one of its MCP
// servers, and list that server's tools now, as the caller, storing nothing.
//
// The listing is the server's (`PluginCommandController.listTools`): a runner
// of the organization reaches the server with the caller's My vault values,
// so a key it lacks or a sign-in not yet made fails FAILED_PRECONDITION
// naming it. --dry-run lists from this machine instead (discover.ts), with
// the caller's shell environment, and needs no runner.
//
// Choosing the server: `--server` names it; without it a plugin with one
// server uses that one, and a plugin with several is refused with their
// names, because listing every server would start every program.
//
// Signing in: a server that takes a sign-in and finds no login at its
// address in My vault (nor, when it accepts a pasted key, its login key
// saved there) runs the interactive sign-in (sign-in.ts) before listing. Off
// an interactive terminal (CI, pipes) it stops with the commands instead of
// waiting for a browser. A server that accepts only a sign-in cannot be
// listed by --dry-run: its token lives in the caller's vault on the server,
// never on this machine.

import { create } from "@bufbuild/protobuf";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ListPluginToolsInputSchema, type PluginTool } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import type { McpServerEntry } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { PLACEHOLDER_PATTERN } from "@stigmer/plugin-package";
import type { Stigmer } from "@stigmer/sdk";
import { UsageError } from "../../errors/index.js";
import { PlaceholderResolutionError } from "../mcp/placeholder-resolver.js";
import { idPrefixesFor, parseReference } from "../reference.js";
import { holdsLoginFor, toolAddress } from "./address.js";
import { localDiscover } from "./discover.js";
import { readMyVault, runSignIn } from "./sign-in.js";

export interface ConnectOptions {
  /** The plugin, by id, org/slug or slug. */
  readonly reference: string;
  /** `--server`: the server's name in the plugin; unset picks the only one. */
  readonly server?: string;
  readonly org: string;
  /** Bounds --dry-run's local discovery. */
  readonly timeoutMs: number;
  readonly dryRun: boolean;
  /** The web console origin, where a sign-in returns (resolveConsoleURL). */
  readonly consoleURL: string;
  /** Probe the console before opening the browser (local daemon only). */
  readonly probeLocalConsole: boolean;
  /** Whether an interactive terminal is available to run a sign-in. */
  readonly interactive: boolean;
}

export interface ConnectResult {
  readonly plugin: Plugin;
  readonly server: McpServerEntry;
  readonly tools: readonly PluginTool[];
  /** True when the tools were listed from this machine (--dry-run). */
  readonly dryRun: boolean;
}

/** List one of a plugin's MCP servers' tools, through a runner or (--dry-run) locally. */
export async function connectPlugin(client: Stigmer, opts: ConnectOptions): Promise<ConnectResult> {
  const plugin = await resolvePlugin(client, opts.reference, opts.org);
  const name = pluginName(plugin, opts.reference);
  const server = pickServer(plugin, name, opts.server);

  if (opts.dryRun) {
    if (server.signIn?.oauthOnly === true) throw signInOnlyDryRunError(name, server);
    try {
      const tools = await localDiscover(server, plugin.status?.env ?? {}, opts.timeoutMs);
      return { plugin, server, tools, dryRun: true };
    } catch (err) {
      // A ${VAR} placeholder that could not be resolved is a configuration
      // problem, not a discovery failure: say which variable to export.
      if (err instanceof PlaceholderResolutionError) throw unresolvedEnvError(name, server, err);
      throw err;
    }
  }

  const rerun = connectCommand(name, server, plugin.status?.mcpServers.length ?? 1);
  await ensureSignedIn(client, name, server, rerun, opts);
  const listed = await client.plugin.listTools(
    create(ListPluginToolsInputSchema, {
      pluginId: plugin.metadata?.id ?? "",
      server: server.name,
      org: opts.org,
    }),
  );
  return { plugin, server, tools: listed.tools, dryRun: false };
}

/** The command that connects this server again, for guidance. */
function connectCommand(plugin: string, server: McpServerEntry, serverCount: number): string {
  return `stigmer connect plugin ${plugin}${serverCount > 1 ? ` --server ${server.name}` : ""}`;
}

// Resolve a reference (id, org/slug, or bare slug) to the plugin.
async function resolvePlugin(client: Stigmer, reference: string, org: string): Promise<Plugin> {
  const parsed = parseReference(reference, org, idPrefixesFor(ApiResourceKind.plugin));
  if (parsed.kind === "id") return client.plugin.get(parsed.id);
  return client.plugin.getByReference({ org: parsed.org, slug: parsed.slug });
}

function pluginName(plugin: Plugin, reference: string): string {
  return plugin.metadata?.slug || plugin.spec?.name || reference;
}

// The server `--server` names, or the plugin's only one.
function pickServer(plugin: Plugin, name: string, wanted: string | undefined): McpServerEntry {
  const servers = plugin.status?.mcpServers ?? [];
  if (servers.length === 0) {
    throw new UsageError(`plugin '${name}' carries no MCP server, so it has no tools to list`);
  }
  const names = servers.map((s) => s.name).join(", ");
  if (wanted !== undefined && wanted !== "") {
    const found = servers.find((s) => s.name === wanted);
    if (found === undefined) {
      throw new UsageError(`plugin '${name}' has no MCP server '${wanted}'; its servers are: ${names}`);
    }
    return found;
  }
  if (servers.length > 1) {
    throw new UsageError(
      `plugin '${name}' carries ${servers.length} MCP servers: ${names}\n` +
        `Name one with --server: stigmer connect plugin ${name} --server <name>`,
    );
  }
  return servers[0];
}

// The variables an address's headers name: a signing-in server's login key
// is the one its Authorization header carries.
function loginKeysOf(server: McpServerEntry): string[] {
  if (server.transport.case !== "http") return [];
  const keys: string[] = [];
  for (const value of Object.values(server.transport.value.headers)) {
    for (const match of value.matchAll(PLACEHOLDER_PATTERN)) keys.push(match[1]);
  }
  return keys;
}

// Make sure a server that takes a sign-in has a login in My vault before
// listing: run the browser sign-in on a terminal, or stop with guidance.
async function ensureSignedIn(
  client: Stigmer,
  plugin: string,
  server: McpServerEntry,
  rerun: string,
  opts: ConnectOptions,
): Promise<void> {
  if (server.signIn === undefined || server.transport.case !== "http") return;
  const address = toolAddress(server.transport.value.url);
  if (address === undefined) return;

  const oauthOnly = server.signIn.oauthOnly;
  const loginKey = oauthOnly ? undefined : loginKeysOf(server)[0];
  const vault = await readMyVault(client, opts.org);
  if (vault !== undefined) {
    if (holdsLoginFor(vault.spec?.connections ?? {}, address)) return;
    // A server that also accepts a pasted key is satisfied by one saved under
    // its login key; one that accepts only a sign-in refuses static keys.
    if (loginKey !== undefined && Object.hasOwn(vault.spec?.secrets ?? {}, loginKey)) return;
  }

  if (!opts.interactive) throw signInGuidanceError(plugin, server, rerun, loginKey);

  await runSignIn({
    client,
    address,
    serverName: server.name,
    rerun,
    org: opts.org,
    consoleURL: opts.consoleURL,
    probeLocalConsole: opts.probeLocalConsole,
    ...(loginKey !== undefined && { loginKey }),
  });
}

function signInGuidanceError(
  plugin: string,
  server: McpServerEntry,
  rerun: string,
  loginKey: string | undefined,
): UsageError {
  const choices = ["  - Run this command again in an interactive terminal to sign in with your browser"];
  // Only offer the pasted key to a server that accepts one: suggesting it for
  // a sign-in-only server would send the user down a dead end.
  if (loginKey !== undefined) {
    choices.push(`  - Save a key in your vault: stigmer vault set-secret ${loginKey} --mine, then run ${rerun}`);
  }
  return new UsageError(
    `MCP server '${server.name}' of plugin '${plugin}' needs a sign-in, which needs an interactive terminal.\n\n` +
      `To connect it${loginKey === undefined ? "" : ", choose one of"}:\n` +
      choices.join("\n"),
  );
}

function signInOnlyDryRunError(plugin: string, server: McpServerEntry): UsageError {
  return new UsageError(
    `MCP server '${server.name}' accepts only a sign-in, so --dry-run cannot list it from this machine: its token lives in your vault on the server.\n` +
      `Run it without --dry-run and sign in when asked: stigmer connect plugin ${plugin} --server ${server.name}`,
  );
}

// Turn a strict-resolution failure into the variable to export. A variable
// the server reads is the user's to provide; one it does not read is a
// problem with the plugin.
function unresolvedEnvError(plugin: string, server: McpServerEntry, err: PlaceholderResolutionError): UsageError {
  if (server.env.includes(err.variableName)) {
    return new UsageError(
      `MCP server '${server.name}' of plugin '${plugin}' needs ${err.variableName}, but it is not set.\n` +
        "Export it in your shell before running --dry-run.",
    );
  }
  const where = err.context !== undefined ? ` in its ${err.context}` : "";
  return new UsageError(
    `MCP server '${server.name}' of plugin '${plugin}' references \${${err.variableName}}${where} but does not read ${err.variableName}.\n` +
      "This is a problem with the plugin: declare the variable, or remove the placeholder.",
  );
}
