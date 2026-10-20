// `stigmer download <type> <ref>` — download what a resource holds as files.
// A run (`run_`, or `aex_` from before the rename) gives back the artifacts
// its agent saved in its outputs folder, each written at its place in that
// folder; a session gives back what all its turns saved, newest per path; a
// File gives back its bytes under its filename; an eval
// (`<ref>[@<digest|tag>]`) gives back the evals/ folder one of its versions
// was pushed as, unzipped into a new or empty directory.
//
// Runs are the one pre-gate alias, as for `list` and `get`: they are not a
// registered type. Every other type resolves through the registry, is gated
// on the verb matrix's Download promise, and dispatches through
// DOWNLOAD_HANDLERS, so the types `list types --verb download` prints are
// exactly the ones that download. Heavy modules are lazy-imported inside the
// action so `--help` stays fast.
import type { Command } from "commander";
import { ensureAuthenticated, resolveOrganization } from "../config/index.js";
import { UsageError } from "../errors/index.js";
import { type OutputFlags, renderResult } from "../output/index.js";
import { defaultRegistry, Verb } from "../registry/index.js";
import type { DownloadOutcome } from "../resources/download.js";
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
      "download a run's or a session's artifacts, a file, or an eval's folder at a version (eval <ref>[@<digest|tag>])",
    )
    .option(
      "--artifact <name>",
      "runs and sessions: specific artifact to download (by file name or outputs-folder path)",
    )
    .option(
      "-o, --output-dir <dir>",
      "output directory (runs, sessions and files: default '.'; evals: a new or empty directory, default ./<slug>)",
    )
    .option("--all", "runs and sessions: download all artifacts (default)", true)
    .action((type: string, ref: string, options: DownloadFlags, command: Command) =>
      runDownload(type, ref, options, command),
    );
  addResultFlags(download);
}

async function runDownload(type: string, ref: string, options: DownloadFlags, command: Command): Promise<void> {
  const { isRunAlias } = await import("../resources/runs.js");
  if (isRunAlias(type)) {
    await runDownloadRun(ref, options);
    return;
  }

  // A type downloads when the verb matrix promises it and a handler serves
  // it; the registry's conformance suite holds the two equal, so one
  // refusal answers both.
  const info = defaultRegistry().getByAlias(type);
  const { DOWNLOAD_HANDLERS } = await import("../resources/download.js");
  const handler = info?.supportedVerbs.has(Verb.Download) === true ? DOWNLOAD_HANDLERS.get(info.kind) : undefined;
  if (info === undefined || handler === undefined) {
    throw new UsageError(`download not supported for type: ${type}\n\nThe types that download: ${downloadTypes()}`);
  }
  if (handler.answers === "files") refuseResultFlags(options, `a ${info.displayName.toLowerCase()}'s`);

  const { connectBackend } = await import("../backend.js");
  const client = connectBackend();
  ensureAuthenticated(client.config);
  const request = {
    ref,
    org: resolveOrganization(client.config, globalOrg(command)),
    artifactName: options.artifact ?? "",
    outputDir: options.outputDir,
  };

  if (handler.answers === "result") {
    renderResult(await handler.download(client.stigmer, request), resultFormat(options));
    return;
  }
  printOutcome(await handler.download(client.stigmer, request, stderrSink), handler.noun, `${info.singular}: ${ref}`);
}

async function runDownloadRun(id: string, options: DownloadFlags): Promise<void> {
  refuseResultFlags(options, "a run's");

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

  const outcome = await downloadRunArtifacts(
    client.stigmer,
    id,
    { artifactName: options.artifact ?? "", outputDir: options.outputDir ?? "." },
    stderrSink,
  );
  printOutcome(outcome, "artifact", `run: ${id}`);
}

// The result flags shape an eval download's answer; a download that prints
// its files as it writes them would ignore one, so it is refused.
function refuseResultFlags(options: DownloadFlags, whose: string): void {
  if (options.json === true || options.quiet === true) {
    throw new UsageError(`--json and --quiet apply to \`download eval\`; ${whose} download prints the files it writes`);
  }
}

// The types that download, from the registry: runs, then every registered
// type whose verb matrix row promises Download.
function downloadTypes(): string {
  return ["run", ...defaultRegistry().typesForVerb(Verb.Download).map((info) => info.singular)].join(", ");
}

function stderrSink(line: string): void {
  process.stderr.write(`${line}\n`);
}

function printOutcome(outcome: DownloadOutcome, noun: string, subject: string): void {
  if (outcome.noArtifacts) {
    process.stdout.write(`\nNo artifacts found for ${subject}\n\n`);
    process.stdout.write(
      "Tip: Artifacts are the files an agent saves in its outputs folder (.stigmer/outputs/). Not every run saves one.\n\n",
    );
    return;
  }

  if (outcome.downloaded === outcome.total) {
    process.stdout.write(`\nDownloaded ${outcome.downloaded} ${noun}(s) successfully\n`);
  } else {
    process.stdout.write(`\nDownloaded ${outcome.downloaded} of ${outcome.total} ${noun}s\n`);
  }
}
