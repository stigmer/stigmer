// `stigmer download <type> <ref>` — download what a resource holds as files.
// A run (`run_`, or `aex_` from before the rename) gives back the artifacts
// its agent saved in its outputs folder, each written at its place in that
// folder; an eval (`<ref>[@<digest|tag>]`) gives back the evals/
// folder one of its versions was pushed as, unzipped into a new or empty
// directory. Heavy modules are lazy-imported inside the action so `--help`
// stays fast.
import type { Command } from "commander";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import { UsageError } from "../errors/index.js";
import { type OutputFlags, renderResult } from "../output/index.js";
import { defaultRegistry } from "../registry/index.js";
import { addResultFlags, globalOrg, resultFormat } from "./shared.js";

interface DownloadFlags extends OutputFlags {
  artifact?: string;
  outputDir?: string;
  all?: boolean;
}

export function registerDownload(program: Command): void {
  const download = program
    .command("download <type> <ref>")
    .description(
      "download a run's artifacts, or an eval's folder at a version (eval <ref>[@<digest|tag>])",
    )
    .option("--artifact <name>", "runs: specific artifact to download (by file name or outputs-folder path)")
    .option(
      "-o, --output-dir <dir>",
      "output directory (runs: default '.'; evals: a new or empty directory, default ./<slug>)",
    )
    .option("--all", "runs: download all artifacts (default)", true)
    .action((type: string, ref: string, options: DownloadFlags, command: Command) =>
      isDownloadEvalType(type) ? runDownloadEval(ref, options, command) : runDownload(type, ref, options),
    );
  addResultFlags(download);
}

function isDownloadEvalType(type: string): boolean {
  return defaultRegistry().getByAlias(type)?.kind === ApiResourceKind.eval;
}

/**
 * `stigmer download eval <ref>[@<digest|tag>]`: the version the reference
 * names (the current one without a suffix), checked against its digest and
 * unzipped into a new or empty directory.
 */
async function runDownloadEval(input: string, options: DownloadFlags, command: Command): Promise<void> {
  const format = resultFormat(options);
  const [{ connectBackend }, { idPrefixesFor, parseReference }, evalModule] = await Promise.all([
    import("../backend.js"),
    import("../resources/reference.js"),
    import("../resources/eval.js"),
  ]);
  const { ref, version } = evalModule.splitEvalVersion(input);
  const client = connectBackend();
  ensureAuthenticated(client.config);
  const org = resolveOrganization(client.config, globalOrg(command));
  const parsed = parseReference(ref, org, idPrefixesFor(ApiResourceKind.eval));
  const outcome = await evalModule.downloadEval(client.stigmer, parsed, version, options.outputDir);
  renderResult(evalModule.renderEvalDownload(outcome), format);
}

function isDownloadRunType(type: string): boolean {
  const normalized = type.trim().toLowerCase();
  return normalized === "run" || normalized === "runs";
}

async function runDownload(type: string, id: string, options: DownloadFlags): Promise<void> {
  if (!isDownloadRunType(type)) {
    throw new UsageError(`download not supported for type: ${type}\n\nThe types that download: run, eval`);
  }
  // The result flags shape an eval download's answer; a run's download
  // prints its files as it writes them, so a flag it would ignore is refused.
  if (options.json === true || options.quiet === true) {
    throw new UsageError("--json and --quiet apply to `download eval`; a run's download prints the files it writes");
  }

  const [{ connectBackend }, { isRunId }, { downloadRunArtifacts }] = await Promise.all([
    import("../backend.js"),
    import("../resources/reference.js"),
    import("../resources/download.js"),
  ]);

  if (!isRunId(id)) {
    throw new UsageError(`invalid run ID: ${id}\n\nRuns must be referenced by ID (e.g., run_01abc123)`);
  }

  const client = connectBackend();
  ensureAuthenticated(client.config);

  const sink = (line: string): void => {
    process.stderr.write(`${line}\n`);
  };
  const outcome = await downloadRunArtifacts(
    client.stigmer,
    id,
    { artifactName: options.artifact ?? "", outputDir: options.outputDir ?? "." },
    sink,
  );

  if (outcome.noArtifacts) {
    process.stdout.write(`\nNo artifacts found for run: ${id}\n\n`);
    process.stdout.write("Tip: Artifacts are the files an agent saves in its outputs folder (.stigmer/outputs/). Not every run saves one.\n\n");
    return;
  }

  if (outcome.downloaded === outcome.total) {
    process.stdout.write(`\nDownloaded ${outcome.downloaded} artifact(s) successfully\n`);
  } else {
    process.stdout.write(`\nDownloaded ${outcome.downloaded} of ${outcome.total} artifacts\n`);
  }
}
