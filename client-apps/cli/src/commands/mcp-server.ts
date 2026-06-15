// `stigmer mcp-server` — start the Stigmer MCP server.
//
// The server is the TypeScript `@stigmer/mcp-server` package, and the CLI runs it
// IN-PROCESS via its `run(cfg, signal)` embed API — the module exists precisely
// so a host like the CLI embeds it rather than shelling out (the Go CLI shelled
// out only because Go cannot import TypeScript). This avoids a child process, an
// npx/tsx resolution dance, and a second Node startup.
//
// MCP clients (Cursor, Claude Desktop, Windsurf) spawn `stigmer mcp-server` and
// speak the protocol over stdio, so stdout must carry ONLY MCP frames: the CLI's
// logger writes to stderr (see logger.ts) and the server logs to stderr too. The
// CLI owns the shutdown signal and aborts the server's AbortController on
// SIGINT/SIGTERM.
//
// Configuration precedence (matches the Go CLI): flags > env > ~/.stigmer config
// > server defaults. We realize that precedence by bridging config into the
// environment only where unset, then letting explicit flags override, and finally
// letting the server read its Config from the environment.

import type { Command } from "commander";
import type { Config } from "../config/config.js";

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
  STIGMER_API_KEY                API key (auto-resolved from CLI config for cloud)
  STIGMER_MCP_TRANSPORT          stdio | http | both (default: stdio)
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
  applyConfigEnv(load(), process.env);
  applyFlagsEnv(flags, process.env);

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
 * Bridge CLI config into the server's environment, but only where unset, so a
 * pre-existing environment variable (or a flag bridged before this) wins. Local
 * backends connect to the local server without auth; cloud backends contribute
 * the stored endpoint and token.
 */
export function applyConfigEnv(config: Config, env: NodeJS.ProcessEnv): void {
  if (config.backend.type === "local") {
    setIfEmpty(env, "STIGMER_SERVER_ADDRESS", "localhost:7234");
    return;
  }
  const cloud = config.backend.cloud;
  if (cloud !== undefined) {
    setIfEmpty(env, "STIGMER_SERVER_ADDRESS", cloud.endpoint);
    setIfEmpty(env, "STIGMER_API_KEY", cloud.token);
  }
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
