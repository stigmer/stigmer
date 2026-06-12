#!/usr/bin/env node
// mcp-server-stigmer — the Model Context Protocol server for the Stigmer
// platform. Mirrors Go cmd/mcp-server-stigmer/main.go.
//
// Usage:
//   mcp-server-stigmer            Transport from STIGMER_MCP_TRANSPORT (default stdio)
//   mcp-server-stigmer stdio      stdin/stdout JSON-RPC
//   mcp-server-stigmer http       Streamable HTTP
//   mcp-server-stigmer both       Both transports simultaneously
//
// All other settings are read from STIGMER_-prefixed environment variables;
// see ./config.ts for the full list.

import { defaultConfig, run, type Transport } from "../index";

const VALID_TRANSPORTS: readonly string[] = ["stdio", "http", "both"];

async function main(): Promise<void> {
  let cfg = defaultConfig();

  // A positional subcommand overrides the env-var-based transport.
  const sub = process.argv[2];
  if (sub !== undefined) {
    if (!VALID_TRANSPORTS.includes(sub)) {
      process.stderr.write(`unknown subcommand "${sub}" (expected stdio, http, or both)\n`);
      process.exit(1);
    }
    cfg = { ...cfg, transport: sub as Transport };
  }

  const controller = new AbortController();
  const shutdown = () => controller.abort();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await run(cfg, controller.signal);
}

main().catch((err: unknown) => {
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
