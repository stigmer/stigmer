// `stigmer apply` — deploy resources to the backend.
//
//   File mode (-f):     apply individual YAML resource files (or a directory)
//   Declarative mode:   a stigmer.yaml project directory (scan + reconcile)
//
// Resources marshal strictly from YAML to full protos and apply through the raw
// command controllers (preserving metadata.id so updates aren't misrouted as
// creates). Heavy modules are lazy-imported so `--help` stays fast (DD-001).
import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import { UsageError } from "../errors/index.js";
import { CommandResult, type OutputFlags, type OutputFormat, renderResult } from "../output/index.js";
import { addResultFlags, globalOrg, resultFormat } from "./shared.js";

interface ApplyFlags extends OutputFlags {
  file?: string;
  config?: string;
  prune?: boolean;
  dryRun?: boolean;
}

export function registerApply(program: Command): void {
  const apply = program
    .command("apply")
    .description("apply resources from files or a project directory")
    .option("-f, --file <path>", "path to a YAML file or directory")
    .option("--config <path>", "path to a project directory (declarative mode)")
    // S1: Go plumbs --prune but never sends it — the server always reconciles
    // orphans by member set-difference. We reproduce the flag (default on) for
    // parity; it is intentionally a no-op client-side. Tracked as a Go follow-up.
    .option("--prune", "delete orphaned resources (declarative mode)", true)
    .option("--dry-run", "validate without applying")
    .action((options: ApplyFlags, command: Command) => runApply(options, command));
  addResultFlags(apply);
}

async function runApply(options: ApplyFlags, command: Command): Promise<void> {
  const format = resultFormat(options);
  const orgOverride = globalOrg(command);

  if (options.file !== undefined && options.file !== "") {
    await runFileApply(options.file, orgOverride, options.dryRun === true, format);
    return;
  }

  await runDeclarativeApply(options, orgOverride, format);
}

// Declarative mode: detect stigmer.yaml (walk up). Absent → atomic guidance.
// entry_point set → SDK/project synthesis track. Otherwise scan the project and
// reconcile membership. Both project tracks converge on the shared reconciler.
async function runDeclarativeApply(
  options: ApplyFlags,
  orgOverride: string | undefined,
  format: OutputFormat,
): Promise<void> {
  const { detectTrack, applyDeclarative, previewDeclarative } = await import("../resources/apply/declarative.js");

  const startDir = options.config !== undefined && options.config !== "" ? options.config : process.cwd();
  const detect = detectTrack(startDir);

  if (detect.track === "atomic") {
    renderResult(buildAtomicGuidance(), format);
    return;
  }

  if (detect.track === "project") {
    await runProjectApply(detect, orgOverride, format, options.dryRun === true);
    return;
  }

  if (options.dryRun === true) {
    const { results, summary } = previewDeclarative(detect, {
      controller: throwingController,
      warn: (line) => emitWarning(line),
    });
    for (const result of results) renderResult(result, format);
    renderResult(summary, format);
    return;
  }

  const { connectBackend } = await import("../backend.js");
  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveDeclarativeOrg(client.config, detect.project?.metadata?.org, orgOverride);

  const result = await applyDeclarative(detect, {
    controller: client.controller,
    stigmer: client.stigmer,
    org,
    info: (line) => process.stderr.write(`${line}\n`),
    warn: (line) => emitWarning(line),
  });
  renderResult(result, format);
}

// Project (SDK synthesis) track: run the user's entry_point, read the `.pb`
// output, and reconcile membership through the same reconciler the declarative
// track uses. Lazy-imported to preserve the DD-001 boundary (`--help` stays
// fast).
async function runProjectApply(
  detect: import("../resources/apply/declarative.js").DetectResult,
  orgOverride: string | undefined,
  format: OutputFormat,
  dryRun: boolean,
): Promise<void> {
  const { applyProjectTrack, previewProjectTrack } = await import("../resources/apply/synth/project-track.js");

  if (dryRun) {
    renderResult(previewProjectTrack(detect), format);
    return;
  }

  const { connectBackend } = await import("../backend.js");
  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveDeclarativeOrg(client.config, detect.project?.metadata?.org, orgOverride);

  const result = await applyProjectTrack(detect, {
    controller: client.controller,
    stigmer: client.stigmer,
    org,
    info: (line) => process.stderr.write(`${line}\n`),
    warn: (line) => emitWarning(line),
  });
  renderResult(result, format);
}

// Org precedence mirrors Go's resolveApplyOrganization: --org flag, then
// metadata.org in stigmer.yaml, then the configured context. Empty → a clear
// "set your org" usage error.
function resolveDeclarativeOrg(
  config: import("../config/index.js").Config,
  projectOrg: string | undefined,
  override: string | undefined,
): string {
  const resolved = resolveOrganization(config, override ?? (projectOrg !== "" ? projectOrg : undefined));
  if (resolved === "") {
    throw new UsageError(
      "organization not set\n\n" +
        "Specify organization in one of these ways:\n" +
        "  1. Set metadata.org in stigmer.yaml\n" +
        "  2. Use --org flag: stigmer apply --org <org>\n" +
        "  3. Set context: stigmer context set --org <org>",
    );
  }
  return resolved;
}

async function runFileApply(
  path: string,
  orgOverride: string | undefined,
  dryRun: boolean,
  format: OutputFormat,
): Promise<void> {
  const [{ connectBackend }, { resolveApplyItems, requiresOrgContext, applyItem }, { discoverAppliedMcpServers }] =
    await Promise.all([
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
  const org = requiresOrgContext(items) ? resolveOrganization(client.config, orgOverride) : "";

  const appliedMcpServers = [];
  for (const item of items) {
    const outcome = await applyItem(client.controller, item, org, false);
    emitWarning(outcome.warning);
    renderResult(outcome.result, format);
    if (outcome.appliedMcpServer !== undefined) appliedMcpServers.push(outcome.appliedMcpServer);
  }

  await discoverAppliedMcpServers(client.stigmer, appliedMcpServers, (line) => process.stderr.write(`${line}\n`));
}

function buildAtomicGuidance(): CommandResult {
  const result = CommandResult.warning("No stigmer.yaml found in current directory or parents");
  result
    .addSection("")
    .item("The 'stigmer apply' command (without -f) requires a project with stigmer.yaml")
    .item("This enables resource discovery and project-based reconciliation");
  result
    .addSection("For single-resource deployment, use file mode")
    .item("stigmer apply -f agent.yaml")
    .item("stigmer apply -f workflow.yaml")
    .item("stigmer apply -f mcpserver.yaml");
  result.hint("To create a project: add a stigmer.yaml with your project name, then run 'stigmer apply'");
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
