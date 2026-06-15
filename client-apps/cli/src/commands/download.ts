// `stigmer download <type> <id>` — download artifacts produced by an execution.
// Only agent executions (`aex_`) are supported today. Heavy modules are
// lazy-imported inside the action so `--help` stays fast (DD-001).
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
    .description("download artifacts from an execution")
    .option("--artifact <name>", "specific artifact to download (by name)")
    .option("-o, --output-dir <dir>", "output directory for downloaded files", ".")
    .option("--all", "download all artifacts (default)", true)
    .action((type: string, id: string, options: DownloadFlags) => runDownload(type, id, options));
}

function isDownloadExecutionType(type: string): boolean {
  const normalized = type.trim().toLowerCase();
  return normalized === "execution" || normalized === "executions" || normalized === "exec";
}

async function runDownload(type: string, id: string, options: DownloadFlags): Promise<void> {
  if (!isDownloadExecutionType(type)) {
    throw new UsageError(`download not supported for type: ${type}\n\nCurrently only 'execution' type supports download`);
  }

  const [{ connectBackend }, { isAgentExecutionId }, { downloadExecutionArtifacts }] = await Promise.all([
    import("../backend.js"),
    import("../resources/execution.js"),
    import("../resources/download.js"),
  ]);

  if (!isAgentExecutionId(id)) {
    throw new UsageError(`invalid execution ID: ${id}\n\nExecutions must be referenced by ID (e.g., aex_01abc123)`);
  }

  const client = connectBackend();
  ensureAuthenticated(client.config);

  const sink = (line: string): void => {
    process.stderr.write(`${line}\n`);
  };
  const outcome = await downloadExecutionArtifacts(
    client.stigmer,
    id,
    { artifactName: options.artifact ?? "", outputDir: options.outputDir ?? "." },
    sink,
  );

  if (outcome.noArtifacts) {
    process.stdout.write(`\nNo artifacts found for execution: ${id}\n\n`);
    process.stdout.write("Tip: Artifacts are files created by the agent during execution. Not all agents produce artifacts.\n\n");
    return;
  }

  if (outcome.downloaded === outcome.total) {
    process.stdout.write(`\nDownloaded ${outcome.downloaded} artifact(s) successfully\n`);
  } else {
    process.stdout.write(`\nDownloaded ${outcome.downloaded} of ${outcome.total} artifacts\n`);
  }
}
