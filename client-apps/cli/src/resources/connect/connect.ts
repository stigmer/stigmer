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
//
// Signing in again: `--sign-in-again` runs the same sign-in even when My
// vault already holds a login for the address, and the vault's own rule
// replaces the saved login, so a login that expired or was revoked is
// renewed without removing it first. Whether My vault already serves the
// server is my-vault.ts's rule, the one `get plugin` reports with.
//
// A listing refused for its login (the server's sentence asking to check the
// sign-in or key, or the runner's "requires OAuth" when the address answered
// with a sign-in challenge) is said in the server's words, ending with the
// command that signs in again.

import { create } from "@bufbuild/protobuf";
import type { Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { ListPluginToolsInputSchema, type PluginTool } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/io_pb";
import type { McpServerEntry } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Stigmer } from "@stigmer/client";
import { CliExitError, ExitCode, UsageError } from "../../errors/index.js";
import { PlaceholderResolutionError } from "../mcp/placeholder-resolver.js";
import { idPrefixOf, parseReference } from "../reference.js";
import { toolAddress } from "./address.js";
import { localDiscover } from "./discover.js";
import { loginKeyOf, readMyVault, serverLogin } from "./my-vault.js";
import { runSignIn } from "./sign-in.js";

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
  /** `--sign-in-again`: sign in even when My vault holds a login, replacing it. */
  readonly signInAgain?: boolean;
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
    if (opts.signInAgain === true) {
      throw new UsageError("--sign-in-again signs in through the server, so it cannot run with --dry-run");
    }
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
  try {
    const listed = await client.plugin.listTools(
      create(ListPluginToolsInputSchema, {
        pluginId: plugin.metadata?.id ?? "",
        server: server.name,
        org: opts.org,
      }),
    );
    return { plugin, server, tools: listed.tools, dryRun: false };
  } catch (err) {
    if (server.signIn !== undefined && isLoginRefusal(err)) throw loginRefusedError(err, `${rerun} --sign-in-again`);
    throw err;
  }
}

// The listing's own sentences for a login the server refused: the server's
// ask to check the sign-in or key, and the runner's sign-in challenge.
const LOGIN_REFUSALS = ["your sign-in or key is valid", "requires OAuth"];

function isLoginRefusal(err: unknown): err is Error {
  return err instanceof Error && LOGIN_REFUSALS.some((words) => err.message.includes(words));
}

/** The command's last line when a listing was refused for its login. */
export function signInAgainHint(command: string): string {
  return `If your login has expired or was revoked, run ${command}.`;
}

// The server's sentence, kept as its answer (its status stays the refusal's),
// with the way to a fresh login after it.
function loginRefusedError(err: Error, command: string): CliExitError {
  return new CliExitError(err.message, ExitCode.General, [signInAgainHint(command)], { cause: err });
}

/** The command that connects this server again, for guidance. */
function connectCommand(plugin: string, server: McpServerEntry, serverCount: number): string {
  return `stigmer connect plugin ${plugin}${serverCount > 1 ? ` --server ${server.name}` : ""}`;
}

// Resolve a reference (id, org/slug, or bare slug) to the plugin.
async function resolvePlugin(client: Stigmer, reference: string, org: string): Promise<Plugin> {
  const parsed = parseReference(reference, org, idPrefixOf(ApiResourceKind.plugin));
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

// Make sure a server that takes a sign-in has a login in My vault before
// listing: run the browser sign-in on a terminal, or stop with guidance.
async function ensureSignedIn(
  client: Stigmer,
  plugin: string,
  server: McpServerEntry,
  rerun: string,
  opts: ConnectOptions,
): Promise<void> {
  const again = opts.signInAgain === true;
  if (server.signIn === undefined || server.transport.case !== "http") {
    if (again) throw new UsageError(`MCP server '${server.name}' of plugin '${plugin}' does not sign in, so there is no login to replace`);
    return;
  }
  const address = toolAddress(server.transport.value.url);
  if (address === undefined) {
    if (again) throw new UsageError(`MCP server '${server.name}' of plugin '${plugin}' names no address a login is saved at`);
    return;
  }

  const oauthOnly = server.signIn.oauthOnly;
  const loginKey = oauthOnly ? undefined : loginKeyOf(server);
  // A server that also accepts a pasted key is satisfied by one saved under
  // its login key; one that accepts only a sign-in refuses static keys.
  if (!again && serverLogin(await readMyVault(client, opts.org), server).signedIn) return;

  if (!opts.interactive) throw signInGuidanceError(plugin, server, again ? `${rerun} --sign-in-again` : rerun, loginKey);

  await runSignIn({
    client,
    address,
    serverName: server.name,
    rerun: again ? `${rerun} --sign-in-again` : rerun,
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
