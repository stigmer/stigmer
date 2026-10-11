// `stigmer mcp add <name> <url> [--header K=V ...]`: install the MCP server
// at an address as a plugin named <name>, the way Claude Code's `claude mcp
// add` adds one. An MCP server lives only in a plugin, so this is the short
// way to a plugin holding one server; the plugin is then used like any
// other (`stigmer run --plugin <name>`, an agent's `plugins`) and removed
// with `stigmer delete plugin <name>`.
//
// The push is `stigmer install`'s: the same prepared archive, the same
// install summary and next steps. `stigmer mcp-server` (no space) is a
// different command: it starts Stigmer's own MCP server for IDEs.
//
// Heavy modules load lazily inside the action so `--help` stays fast.

import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import { type OutputFlags, renderResult } from "../output/index.js";
import { collect } from "./agent-exec-flags.js";
import { addResultFlags, globalOrg, resultFormat } from "./shared.js";

interface McpAddFlags extends OutputFlags {
  header: string[];
  visibility?: string;
  dryRun?: boolean;
}

export function registerMcp(program: Command): void {
  const mcp = program
    .command("mcp")
    .description("install an MCP server as a plugin of its own");

  const add = mcp
    .command("add <name> <url>")
    .description("install the MCP server at <url> as a plugin named <name>")
    .option(
      "--header <name=value>",
      "a header sent with every request (repeatable); a value may name a key in your vault as ${NAME}",
      collect,
      [],
    )
    .option("--visibility <level>", "visibility for the plugin (private, org, child-orgs)")
    .option("--dry-run", "show the plugin that would install, without pushing")
    .action((name: string, url: string, options: McpAddFlags, command: Command) =>
      runMcpAdd(name, url, options, command),
    );
  addResultFlags(add);
}

async function runMcpAdd(
  name: string,
  url: string,
  options: McpAddFlags,
  command: Command,
): Promise<void> {
  const format = resultFormat(options);
  const [{ parseHeaders, prepareServerPlugin }, plugin, { parseVisibility }, { CommandResult }] =
    await Promise.all([
      import("../resources/mcp/add.js"),
      import("../resources/plugin.js"),
      import("../resources/skill.js"),
      import("../output/index.js"),
    ]);

  const visibility = parseVisibility(options.visibility, "--visibility");
  const prepared = await prepareServerPlugin(name, url, parseHeaders(options.header));

  if (options.dryRun === true) {
    const result = plugin.describePackageOn(
      CommandResult.success(`Dry run: plugin '${prepared.plugin.name}' would install`),
      prepared.plugin,
      prepared.warnings,
      prepared.stats,
    );
    result.hint("Run without --dry-run to install it.");
    renderResult(result, format);
    return;
  }

  const { connectBackend } = await import("../backend.js");
  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));
  const outcome = await plugin.pushPrepared(client.stigmer, prepared, {
    org,
    visibility,
    message: "added with stigmer mcp add",
  });
  renderResult(
    plugin.renderPushOutcome(outcome, { next: plugin.nextSteps(outcome.plugin) }),
    format,
  );
}
