// `stigmer runs logs <run-id>` — view or stream a run's logs.
// Thin handler: resolve the client, wire Ctrl-C to abort a follow cleanly, and
// delegate to resources/run-logs.ts. Mirrors Go's execution_logs.go.

import type { Command } from "commander";
import { ensureAuthenticated } from "../../config/index.js";

interface LogsFlags {
  follow?: boolean;
}

export function registerRunsLogs(runs: Command): void {
  runs
    .command("logs <run-id>")
    .description("view run message logs (use --follow to stream)")
    .option("-f, --follow", "stream live events")
    .action((runId: string, options: LogsFlags) => runLogs(runId, options));
}

async function runLogs(runId: string, options: LogsFlags): Promise<void> {
  const [{ connectBackend }, { streamRunLogs }] = await Promise.all([
    import("../../backend.js"),
    import("../../resources/run-logs.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);

  // Ctrl-C aborts the subscription; the resource treats an aborted signal as a
  // clean exit (Go cancels the stream context on signal).
  const controller = new AbortController();
  const onSignal = (): void => controller.abort();
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    await streamRunLogs(
      client.stigmer,
      { runId, follow: options.follow === true },
      controller.signal,
    );
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}
