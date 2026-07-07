// `stigmer connect mcp-server <slug-or-id>` — connect to an MCP server, discover
// its tools and resource templates, and push the results to the backend (or
// preview locally with --dry-run). Mirrors Go's connect.go.
//
// Thin handler: resolve the client/org, delegate to resources/connect, render.
// Heavy modules (backend client, MCP SDK) are lazy-imported so `--help` stays
// fast (DD-001).

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import { UsageError } from "../errors/index.js";
import { shouldColorize } from "../output/style.js";
import { globalOrg } from "./shared.js";

interface ConnectFlags {
  timeout?: string;
  dryRun?: boolean;
  env: string[];
}

const DEFAULT_TIMEOUT_SECONDS = 30;

export function registerConnect(program: Command): void {
  const connect = program.command("connect").description("connect to external services and discover capabilities");

  connect
    .command("mcp-server <slug-or-id>")
    .description("connect to an MCP server and discover its tools")
    .option("--timeout <seconds>", "timeout for connection and discovery", String(DEFAULT_TIMEOUT_SECONDS))
    .option("--dry-run", "discover and display results without pushing to the backend")
    .option(
      "--env <KEY=VALUE>",
      "environment variable for the MCP server (repeatable)",
      (value: string, previous: string[]) => [...previous, value],
      [],
    )
    .action((reference: string, options: ConnectFlags, command: Command) => runConnect(reference, options, command));
}

async function runConnect(reference: string, options: ConnectFlags, command: Command): Promise<void> {
  const timeoutMs = parseTimeout(options.timeout);
  const [{ connectBackend }, { connectMcpServer }, { renderConnectResult }] = await Promise.all([
    import("../backend.js"),
    import("../resources/connect/connect.js"),
    import("../resources/connect/display.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));

  // Connecting pushes to the backend, which requires an org for credential
  // resolution. Fail with actionable guidance instead of the backend's cryptic
  // "org value length must be at least 1" validation error. Dry-run discovers
  // locally (no backend push) and needs no org for an id reference, so it is
  // exempt — mirrors the org guard in run/draft/resume.
  if (options.dryRun !== true && org === "") {
    throw new UsageError(
      "organization not set\n\n" +
        "Set it with:\n" +
        "  stigmer config context set --org <org>\n" +
        "  stigmer connect mcp-server <server> --org <org>",
    );
  }

  const result = await connectMcpServer(client.stigmer, {
    reference,
    org,
    timeoutMs,
    dryRun: options.dryRun === true,
    envOverrides: options.env,
    backendType: client.config.backend.type,
    interactive: process.stderr.isTTY === true,
  });

  const colorize = shouldColorize(process.stdout);
  renderConnectResult(result, (line) => process.stdout.write(`${line}\n`), colorize);
}

// Parse --timeout seconds into milliseconds. Mirrors Go's DurationVar default
// but accepts a plain number of seconds for a simpler CLI surface.
function parseTimeout(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_TIMEOUT_SECONDS * 1000;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new UsageError(`invalid --timeout '${raw}': expected a number of seconds`);
  }
  return Math.round(seconds * 1000);
}
