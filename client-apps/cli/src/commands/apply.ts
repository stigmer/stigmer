// `stigmer apply` — deploy resources to the backend.
//
//   File mode (-f):     apply individual YAML resource files (or a directory)
//   Plugin track:       a directory holding a plugin manifest (the -f path,
//                       or the working directory) installs as a plugin — the
//                       same read, zip and push as `push plugin <dir>`, so the
//                       two verbs are one code path
//
// A bare `stigmer apply` in a directory that is neither prints what the
// command can do. A `stigmer.yaml` there is the retired Project format, and
// the guidance says so: a folder of resources that belong together is a
// plugin.
//
// Resources marshal strictly from YAML to full protos and apply through the raw
// command controllers (preserving metadata.id so updates aren't misrouted as
// creates). Heavy modules are lazy-imported so `--help` stays fast (DD-001).
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import {
  CommandResult,
  type OutputFlags,
  type OutputFormat,
  renderResult,
} from "../output/index.js";
import { addResultFlags, globalOrg, resultFormat } from "./shared.js";

/**
 * The manifest file the retired Project format kept at a directory's root.
 * Read only to recognise an old repository and say what happened to it.
 */
const RETIRED_PROJECT_FILE = "stigmer.yaml";

interface ApplyFlags extends OutputFlags {
  file?: string;
  dryRun?: boolean;
}

export function registerApply(program: Command): void {
  const apply = program
    .command("apply")
    .description("apply resources from files or a plugin directory")
    .option("-f, --file <path>", "path to a YAML file, a directory of YAML files, or a plugin directory")
    .option("--dry-run", "validate without applying")
    .action((options: ApplyFlags, command: Command) =>
      runApply(options, command),
    );
  addResultFlags(apply);
}

async function runApply(options: ApplyFlags, command: Command): Promise<void> {
  const format = resultFormat(options);
  const orgOverride = globalOrg(command);

  // A plugin manifest at the given directory's root selects the plugin
  // track before any YAML scan: a repository holding both is applied as a
  // plugin, and its `ai.stigmer/*.yaml` documents are the plugin's, not
  // loose resources.
  const target =
    options.file !== undefined && options.file !== ""
      ? options.file
      : process.cwd();
  const { isPluginDirectory } = await import("../resources/plugin.js");
  if (isPluginDirectory(target)) {
    await runPluginApply(target, orgOverride, options.dryRun === true, format);
    return;
  }

  if (options.file !== undefined && options.file !== "") {
    await runFileApply(
      options.file,
      orgOverride,
      options.dryRun === true,
      format,
    );
    return;
  }

  renderResult(buildGuidance(target), format);
}

// Plugin track: install or upgrade the plugin folder as one unit through the
// same read, zip and push `push plugin` runs; the org resolves like every
// other apply (--org, then the configured context).
async function runPluginApply(
  dir: string,
  orgOverride: string | undefined,
  dryRun: boolean,
  format: OutputFormat,
): Promise<void> {
  const plugin = await import("../resources/plugin.js");
  const ignoreOptions = {
    respectGitignore: true,
    extraIgnore: [],
    extraInclude: [],
  };
  if (dryRun) {
    const { readPluginPackage } = await import("@stigmer/plugin-package");
    const read = plugin.readPluginDirectory(dir, ignoreOptions);
    const outcome = readPluginPackage(read.files);
    if (!outcome.ok) {
      throw plugin.pluginRefusal(dir, outcome.errors, outcome.warnings);
    }
    const result = plugin.describePackageOn(
      CommandResult.success(
        `Dry run: plugin '${outcome.plugin.name}' would install`,
      ),
      outcome.plugin,
      outcome.warnings,
      read.stats,
    );
    result.hint("Run without --dry-run to install it.");
    renderResult(result, format);
    return;
  }
  const { connectBackend } = await import("../backend.js");
  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, orgOverride);
  const outcome = await plugin.pushPlugin(client.stigmer, dir, {
    org,
    visibility: undefined,
    message: "",
    ignoreOptions,
  });
  renderResult(
    plugin.renderPushOutcome(outcome, {
      next: await plugin.readNextSteps(client.stigmer, org, outcome.members),
    }),
    format,
  );
}

async function runFileApply(
  path: string,
  orgOverride: string | undefined,
  dryRun: boolean,
  format: OutputFormat,
): Promise<void> {
  const [
    { connectBackend },
    { resolveApplyItems, requiresOrgContext, applyItem },
    { discoverAppliedMcpServers },
  ] = await Promise.all([
    import("../backend.js"),
    import("../resources/apply/apply.js"),
    import("../resources/apply/discovery.js"),
  ]);

  const items = resolveApplyItems(path);

  // Dry-run never touches the backend: marshal + preview only.
  if (dryRun) {
    for (const item of items) {
      const outcome = await applyItem(throwingController, item, "", true);
      emitWarning(outcome.warning);
      renderResult(outcome.result, format);
    }
    return;
  }

  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = requiresOrgContext(items)
    ? resolveOrganization(client.config, orgOverride)
    : "";

  const appliedMcpServers = [];
  for (const item of items) {
    const outcome = await applyItem(client.controller, item, org, false);
    emitWarning(outcome.warning);
    renderResult(outcome.result, format);
    if (outcome.appliedMcpServer !== undefined)
      appliedMcpServers.push(outcome.appliedMcpServer);
  }

  await discoverAppliedMcpServers(
    client.stigmer,
    appliedMcpServers,
    org,
    (line) => process.stderr.write(`${line}\n`),
  );
}

// What a bare `stigmer apply` says when the target holds no plugin manifest:
// the two things the command does, and, when a `stigmer.yaml` sits there,
// what that file was and where its resources go now.
function buildGuidance(target: string): CommandResult {
  const result = CommandResult.warning(`No plugin manifest in ${target}`);
  result
    .addSection("What 'stigmer apply' does")
    .item("stigmer apply -f <file>        apply a resource file (agent, workflow, MCP server, ...)")
    .item("stigmer apply -f <dir>         apply every YAML file in a directory")
    .item("stigmer push skill <dir>       publish a skill folder")
    .item("stigmer push plugin <dir>      install a folder of resources as one plugin");
  if (existsSync(join(target, RETIRED_PROJECT_FILE))) {
    result
      .addSection(`About the ${RETIRED_PROJECT_FILE} here`)
      .item(
        "It is the Project format, which Stigmer no longer has. A folder of resources that belong together is a plugin: run `stigmer push plugin <dir>`, or apply each resource file with `stigmer apply -f`.",
      );
  }
  return result;
}

function emitWarning(warning: string | undefined): void {
  if (warning !== undefined) process.stderr.write(`${warning}\n`);
}

// In dry-run we still call applyItem but it never reaches the controller; this
// guard makes that contract explicit (and fails loudly if it ever regresses).
const throwingController = (() => {
  throw new Error("controller must not be used during dry-run");
}) as unknown as import("../resources/apply/handlers.js").ControllerFn;
