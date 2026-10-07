// `stigmer download <type> <id>` — download artifacts produced by a run.
// Only runs (`run_`, or `aex_` from before the rename) are supported today. Heavy modules are
// lazy-imported inside the action so `--help` stays fast.
import type { Command } from "commander";
import { ensureAuthenticated } from "../config/index.js";
import { UsageError } from "../errors/index.js";

interface DownloadFlags {
  artifact?: string;
  outputDir?: string;
  all?: boolean;
}

export function registerDownload(program: Command): void {
  program
    .command("download <type> <id>")
    .description("download artifacts from a run")
    .option("--artifact <name>", "specific artifact to download (by name)")
    .option("-o, --output-dir <dir>", "output directory for downloaded files", ".")
    .option("--all", "download all artifacts (default)", true)
    .action((type: string, id: string, options: DownloadFlags) => runDownload(type, id, options));
}

function isDownloadRunType(type: string): boolean {
  const normalized = type.trim().toLowerCase();
  return normalized === "run" || normalized === "runs";
}

async function runDownload(type: string, id: string, options: DownloadFlags): Promise<void> {
  if (!isDownloadRunType(type)) {
    throw new UsageError(`download not supported for type: ${type}\n\nCurrently only 'run' type supports download`);
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
    process.stdout.write("Tip: Artifacts are files created by the agent during a run. Not all agents produce artifacts.\n\n");
    return;
  }

  if (outcome.downloaded === outcome.total) {
    process.stdout.write(`\nDownloaded ${outcome.downloaded} artifact(s) successfully\n`);
  } else {
    process.stdout.write(`\nDownloaded ${outcome.downloaded} of ${outcome.total} artifacts\n`);
  }
}
