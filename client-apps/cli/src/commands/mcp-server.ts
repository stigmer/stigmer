// `stigmer mcp-server` — start the Stigmer MCP server.
//
// The server is the TypeScript `@stigmer/mcp-server` package, and the CLI runs it
// IN-PROCESS via its `run(cfg, signal)` embed API — the module exists precisely
// so a host like the CLI embeds it rather than shelling out. This avoids a child process, an
// npx/tsx resolution dance, and a second Node startup.
//
// MCP clients (Cursor, Claude Desktop, Windsurf) spawn `stigmer mcp-server` and
// speak the protocol over stdio, so stdout must carry ONLY MCP frames: the CLI's
// logger writes to stderr (see logger.ts) and the server logs to stderr too. The
// CLI owns the shutdown signal and aborts the server's AbortController on
// SIGINT/SIGTERM.
//
// Configuration precedence: flags > env > ~/.stigmer config
// > server defaults. We realize that precedence by bridging config into the
// environment only where unset, then letting explicit flags override, and finally
// letting the server read its Config from the environment.

import type { Command } from "commander";
import { type Config, activeBackend } from "../config/config.js";
import { DEFAULT_CLOUD_ENDPOINT } from "../config/resolve.js";

/** Flags the command bridges into the server's environment. */
export interface McpServerFlags {
  transport?: string;
  port?: string;
  serverAddress?: string;
  apiKey?: string;
  logFormat?: string;
  logLevel?: string;
}

const HELP_AFTER = `
Environment variables:
  STIGMER_SERVER_ADDRESS         gRPC address (default: CLI config, else localhost:7234)
  STIGMER_API_KEY                API key (default: the active CLI backend's credential)
  STIGMER_MCP_TRANSPORT          stdio | http | both (default: stdio)
  STIGMER_MCP_ROSTER             full | channels | memory (default: full; channels = send_channel_message only, memory = remember only)
  STIGMER_MCP_HTTP_PORT          HTTP listen port (default: 8080)
  STIGMER_MCP_LOG_FORMAT         text | json (default: text)
  STIGMER_MCP_LOG_LEVEL          debug | info | warn | error (default: info)

Examples:
  # STDIO mode (default — what MCP clients spawn)
  $ stigmer mcp-server

  # HTTP mode on a custom port
  $ stigmer mcp-server --transport http --port 9090

  # Cursor mcp.json:
  # { "command": "stigmer", "args": ["mcp-server"] }`;

export function registerMcpServer(program: Command): void {
  program
    .command("mcp-server")
    .description("start the MCP server that exposes Stigmer resources to AI coding assistants")
    .option("--transport <mode>", "transport mode: stdio, http, or both (env: STIGMER_MCP_TRANSPORT)")
    .option("--port <port>", "HTTP listen port (env: STIGMER_MCP_HTTP_PORT)")
    .option("--server-address <addr>", "gRPC address of stigmer-server (env: STIGMER_SERVER_ADDRESS)")
    .option("--api-key <key>", "API key for stigmer-server (env: STIGMER_API_KEY)")
    .option("--log-format <fmt>", "log encoding: text or json (env: STIGMER_MCP_LOG_FORMAT)")
    .option("--log-level <level>", "minimum log level: debug, info, warn, or error (env: STIGMER_MCP_LOG_LEVEL)")
    .addHelpText("after", HELP_AFTER)
    .action((flags: McpServerFlags) => runMcpServer(flags));
}

async function runMcpServer(flags: McpServerFlags): Promise<void> {
  const { load } = await import("../config/config.js");
  // Flags first, then the config fills only what is still unset: the same
  // precedence, with the final address known before a credential is bridged.
  applyFlagsEnv(flags, process.env);
  applyConfigEnv(load(), process.env);

  // Imported lazily so `stigmer --help`/`version` never pull in the MCP stack.
  const { run, defaultConfig } = await import("@stigmer/mcp-server");

  const controller = new AbortController();
  const onSignal = (): void => controller.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    await run(defaultConfig(), controller.signal);
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}

/**
 * Bridge the active backend into the server's environment, but only where
 * unset, so a pre-existing environment variable (or a flag bridged before this)
 * wins. The local daemon is reached without auth; a named backend contributes
 * its endpoint and its credential (a cloud login's token, a self-hosted
 * entry's API key). The credential goes only to its own backend: when the
 * environment already names another address (a runner spawning this command
 * for its server), none is bridged.
 */
export function applyConfigEnv(config: Config, env: NodeJS.ProcessEnv): void {
  // Both already given (flags, or a runner's own environment): the config is
  // not read, so a dangling current_backend cannot stop a server that needs
  // nothing from it.
  if (isSet(env.STIGMER_SERVER_ADDRESS) && isSet(env.STIGMER_API_KEY)) return;
  const { entry } = activeBackend(config);
  if (entry === undefined) {
    setIfEmpty(env, "STIGMER_SERVER_ADDRESS", "localhost:7234");
    return;
  }
  const endpoint = entry.endpoint || (entry.type === "cloud" ? DEFAULT_CLOUD_ENDPOINT : undefined);
  if (endpoint === undefined) return;
  setIfEmpty(env, "STIGMER_SERVER_ADDRESS", endpoint);
  if (env.STIGMER_SERVER_ADDRESS !== endpoint) return;
  setIfEmpty(env, "STIGMER_API_KEY", entry.type === "cloud" ? entry.token : entry.api_key);
}

/** Bridge explicitly-set flags into the server's environment (highest precedence). */
export function applyFlagsEnv(flags: McpServerFlags, env: NodeJS.ProcessEnv): void {
  setIfPresent(env, "STIGMER_MCP_TRANSPORT", flags.transport);
  setIfPresent(env, "STIGMER_MCP_HTTP_PORT", flags.port);
  setIfPresent(env, "STIGMER_SERVER_ADDRESS", flags.serverAddress);
  setIfPresent(env, "STIGMER_API_KEY", flags.apiKey);
  setIfPresent(env, "STIGMER_MCP_LOG_FORMAT", flags.logFormat);
  setIfPresent(env, "STIGMER_MCP_LOG_LEVEL", flags.logLevel);
}

function isSet(value: string | undefined): boolean {
  return value !== undefined && value !== "";
}

function setIfEmpty(env: NodeJS.ProcessEnv, key: string, value: string | undefined): void {
  if (value !== undefined && value !== "" && (env[key] === undefined || env[key] === "")) {
    env[key] = value;
  }
}

function setIfPresent(env: NodeJS.ProcessEnv, key: string, value: string | undefined): void {
  if (value !== undefined && value !== "") {
    env[key] = value;
  }
}
