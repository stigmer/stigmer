// `stigmer connect plugin <plugin> [--server <name>]`: list the tools one of
// a plugin's MCP servers offers now, as the caller, after the sign-in it
// takes when My vault holds none; or, with --dry-run, list them from this
// machine without a runner. Nothing is stored either way.
//
// Thin handler: resolve the client/org, delegate to resources/connect, render.
// Heavy modules (backend client, MCP SDK) are lazy-imported so `--help` stays
// fast.

import type { Command } from "commander";
import {
  activeBackend,
  ensureAuthenticated,
  resolveConsoleURL,
  resolveOrganization,
} from "../config/index.js";
import { UsageError } from "../errors/index.js";
import { shouldColorize } from "../output/style.js";
import { globalOrg } from "./shared.js";
import { omitsOrganization, requireOrganization } from "../client/single-org.js";

interface ConnectFlags {
  server?: string;
  timeout?: string;
  dryRun?: boolean;
}

const DEFAULT_TIMEOUT_SECONDS = 30;

export function registerConnect(program: Command): void {
  const connect = program
    .command("connect")
    .description("connect to external services and discover capabilities");

  connect
    .command("plugin <plugin>")
    .description("list the tools one of a plugin's MCP servers offers, signing in first when it needs one")
    .option("--server <name>", "the MCP server, by its name in the plugin (needed when the plugin carries several)")
    .option(
      "--timeout <seconds>",
      "bound --dry-run's local discovery",
      String(DEFAULT_TIMEOUT_SECONDS),
    )
    .option(
      "--dry-run",
      "list the tools from this machine, with your shell's environment, without a runner",
    )
    .action((reference: string, options: ConnectFlags, command: Command) =>
      runConnect(reference, options, command),
    );
}

async function runConnect(
  reference: string,
  options: ConnectFlags,
  command: Command,
): Promise<void> {
  const timeoutMs = parseTimeout(options.timeout);
  const [{ connectBackend }, { connectPlugin }, { renderConnectResult }] =
    await Promise.all([
      import("../backend.js"),
      import("../resources/connect/connect.js"),
      import("../resources/connect/display.js"),
    ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));

  // Listing through a runner reads the caller's My vault in an organization,
  // which a server holding several needs named: fail with actionable
  // guidance instead of the backend's validation error. Dry-run lists
  // locally and needs no org for an id reference, so it is exempt.
  if (options.dryRun !== true) {
    await requireOrganization(client.stigmer, org, [
      "stigmer config context set --org <org>",
      "stigmer connect plugin <plugin> --org <org>",
    ]);
  }

  const result = await connectPlugin(client.stigmer, {
    reference,
    ...(options.server !== undefined && { server: options.server }),
    org,
    timeoutMs,
    dryRun: options.dryRun === true,
    consoleURL: resolveConsoleURL(client.config),
    probeLocalConsole: activeBackend(client.config).entry === undefined,
    interactive: process.stderr.isTTY === true,
  });

  const colorize = shouldColorize(process.stdout);
  const { organizationLabel } = await import("../client/organizations.js");
  const pluginOrg = result.plugin.metadata?.org ?? "";
  renderConnectResult(
    result,
    (line) => process.stdout.write(`${line}\n`),
    colorize,
    (await omitsOrganization(client.stigmer))
      ? undefined
      : await organizationLabel(client.stigmer, pluginOrg),
  );
}

// Parse --timeout seconds into milliseconds.
function parseTimeout(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_TIMEOUT_SECONDS * 1000;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new UsageError(
      `invalid --timeout '${raw}': expected a number of seconds`,
    );
  }
  return Math.round(seconds * 1000);
}
