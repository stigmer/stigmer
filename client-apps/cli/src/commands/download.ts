// `stigmer download <type> <ref>` — download what a resource holds as files.
// A run (`run_`) gives back its outputs,
// the files its agent saved in .stigmer/outputs/, each written at its place
// in that folder; a session gives back what all its turns saved, newest per
// path; a File gives back its bytes under its filename; an eval
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
import { CliExitError, ExitCode, UsageError } from "../errors/index.js";
import { type OutputFlags, renderResult, supportedFormats } from "../output/index.js";
import { defaultRegistry, Verb } from "../registry/index.js";
import type { DownloadOutcome } from "../resources/download.js";
import { addResultFlags, globalOrg, resultFormat } from "./shared.js";

interface DownloadFlags extends OutputFlags {
  path?: string;
  outputDir?: string;
  all?: boolean;
}

export function registerDownload(program: Command): void {
  const download = program
    .command("download <type> <ref>")
    .description(
      "download a run's or a session's outputs, a file, or an eval's folder at a version (eval <ref>[@<digest|tag>])",
    )
    .option(
      "--path <output-path>",
      "runs and sessions: the one output to download, by its path in .stigmer/outputs/ (a bare filename matches too)",
    )
    .option(
      "--output-dir <dir>",
      "output directory (runs, sessions and files: default '.'; evals: a new or empty directory, default ./<slug>)",
    )
    .option("--all", "runs and sessions: download all outputs (default)", true)
    .action((type: string, ref: string, options: DownloadFlags, command: Command) =>
      runDownload(type, ref, options, command),
    );
  addResultFlags(download);
}

async function runDownload(type: string, ref: string, options: DownloadFlags, command: Command): Promise<void> {
  refuseDirectoryAsFormat(options, type, ref);
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
    outputPath: options.path ?? "",
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

  const [{ connectBackend }, { isRunId }, { downloadRunOutputs }] = await Promise.all([
    import("../backend.js"),
    import("../resources/reference.js"),
    import("../resources/download.js"),
  ]);

  if (!isRunId(id)) {
    throw new UsageError(`invalid run ID: ${id}\n\nRuns must be referenced by ID (e.g., run_01abc123)`);
  }

  const client = connectBackend();
  ensureAuthenticated(client.config);

  const outcome = await downloadRunOutputs(
    client.stigmer,
    id,
    { outputPath: options.path ?? "", outputDir: options.outputDir ?? "." },
    stderrSink,
  );
  printOutcome(outcome, "output", `run: ${id}`);
}

// `-o` is the output format on every command; `download -o ./out`, the
// directory under its old short flag, is refused with the flag it meant.
function refuseDirectoryAsFormat(options: DownloadFlags, type: string, ref: string): void {
  const output = options.output;
  if (output === undefined || supportedFormats("mutating").includes(output.toLowerCase() as never)) return;
  throw new UsageError(
    `-o is the output format (table or json); the directory is --output-dir:\n  stigmer download ${type} ${ref} --output-dir ${output}`,
  );
}

// The result flags shape an eval download's answer; a download that prints
// its files as it writes them would ignore one, so it is refused.
function refuseResultFlags(options: DownloadFlags, whose: string): void {
  if (options.json === true || options.quiet === true || options.output !== undefined) {
    throw new UsageError(`-o, --json and --quiet apply to \`download eval\`; ${whose} download prints the files it writes`);
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
  if (outcome.noOutputs) {
    process.stdout.write(`\nNo outputs found for ${subject}\n\n`);
    process.stdout.write("Tip: outputs are the files an agent saves in .stigmer/outputs/. Not every run saves one.\n\n");
    return;
  }

  if (outcome.downloaded === outcome.total) {
    process.stdout.write(`\nDownloaded ${outcome.downloaded} ${noun}(s) successfully\n`);
    return;
  }
  // A partial download still writes what it could, but a script branching
  // on `$?` must not read it as done.
  throw new CliExitError(`downloaded ${outcome.downloaded} of ${outcome.total} ${noun}s`, ExitCode.General);
}
