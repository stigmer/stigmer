// `stigmer execution logs <execution-id>` — view or stream execution logs.
// Thin handler: resolve the client, wire Ctrl-C to abort a follow cleanly, and
// delegate to resources/execution-logs.ts. Mirrors Go's execution_logs.go.

import type { Command } from "commander";
import { ensureAuthenticated } from "../../config/index.js";

interface LogsFlags {
  follow?: boolean;
  task?: string;
}

export function registerExecutionLogs(execution: Command): void {
  execution
    .command("logs <execution-id>")
    .description("view execution event logs (use --follow to stream)")
    .option("-f, --follow", "stream live events")
    .option("--task <name>", "filter events by task name (workflow only)")
    .action((executionId: string, options: LogsFlags) => runLogs(executionId, options));
}

async function runLogs(executionId: string, options: LogsFlags): Promise<void> {
  const [{ connectBackend }, { streamExecutionLogs }] = await Promise.all([
    import("../../backend.js"),
    import("../../resources/execution-logs.js"),
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
    await streamExecutionLogs(
      client.stigmer,
      { executionId, follow: options.follow === true, task: options.task },
      controller.signal,
    );
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}
