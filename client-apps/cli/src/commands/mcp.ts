// `stigmer mcp add <name> <url> [--header K=V ...]`: install the MCP server
// at an address as a plugin named <name>, the way Claude Code's `claude mcp
// add` adds one. A server lives in a plugin or in an agent's own
// `mcp_servers` (which only an organization's admins write); this is the
// short way to a plugin holding one server, which is then used like any
// other (`stigmer run --plugin <name>`, an agent's `plugins`) and removed
// with `stigmer delete plugin <name>`.
//
// Run again with the name of a plugin it made, it changes that plugin (a new
// address, headers or description), keeping the plugin's visibility and its
// description unless given again. A plugin pushed from a folder is refused
// rather than flattened into one server (resources/mcp/add.ts); --dry-run
// says which of the three it would do.
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
  description?: string;
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
    .option(
      "--description <text>",
      "what the server is for, shown on the plugin's page; an existing plugin keeps its own when omitted",
    )
    .option(
      "--visibility <level>",
      "visibility for the plugin (private, org, child-orgs); an existing plugin keeps its own when omitted",
    )
    .option("--dry-run", "show whether the plugin would install, change or be refused, without pushing")
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
  const [add, plugin, { parseVisibility }, { CommandResult }, { connectBackend }] = await Promise.all([
    import("../resources/mcp/add.js"),
    import("../resources/plugin.js"),
    import("../resources/skill.js"),
    import("../output/index.js"),
    import("../backend.js"),
  ]);

  const visibility = parseVisibility(options.visibility, "--visibility");
  const headers = add.parseHeaders(options.header);
  const given = { name, url, headers, ...(options.description !== undefined && { description: options.description }) };
  // Refuse a name or an address no plugin may carry before reading anything.
  let prepared = await add.prepareServerPlugin(given);

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));
  const installed = await add.readInstalledUnderName(client.stigmer, org, prepared.plugin.name);
  if (installed.kind === "other") throw add.notOneServerRefusal(prepared.plugin.name, installed.plugin);

  // A change keeps what it does not name: the description the plugin has,
  // and its visibility.
  let pushVisibility = visibility;
  if (installed.kind === "one-server") {
    if (options.description === undefined && installed.server.description !== undefined) {
      prepared = await add.prepareServerPlugin({ ...given, description: installed.server.description });
    }
    pushVisibility = visibility ?? installed.plugin.metadata?.visibility;
  }

  if (options.dryRun === true) {
    const headline =
      installed.kind === "none"
        ? `Dry run: plugin '${prepared.plugin.name}' would install`
        : installed.plugin.status?.digest === prepared.digest && pushVisibility === installed.plugin.metadata?.visibility
          ? `Dry run: plugin '${prepared.plugin.name}' already is this server; nothing would change`
          : `Dry run: plugin '${prepared.plugin.name}' would change (${installed.server.url} → ${url.trim()})`;
    const result = plugin.describePackageOn(
      CommandResult.success(headline),
      prepared.plugin,
      prepared.warnings,
      prepared.stats,
    );
    result.hint("Run without --dry-run to do it.");
    renderResult(result, format);
    return;
  }

  const outcome = await plugin.pushPrepared(client.stigmer, prepared, {
    org,
    visibility: pushVisibility,
    message: installed.kind === "none" ? "added with stigmer mcp add" : "changed with stigmer mcp add",
  });
  renderResult(
    plugin.renderPushOutcome(outcome, { next: plugin.nextSteps(outcome.plugin) }),
    format,
  );
}
