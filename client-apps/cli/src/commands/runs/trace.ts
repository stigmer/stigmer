// `stigmer runs trace <run-id>` — show the run's tool-call structure.
// Thin handler: resolve the client and format, delegate to
// resources/run-trace.ts. Mirrors Go's execution_trace.go.

import type { Command } from "commander";
import { ensureAuthenticated } from "../../config/index.js";
import type { OutputFlags } from "../../output/index.js";
import type { TraceFormat } from "../../resources/run-trace.js";
import { addReadFlags, readFormat } from "../shared.js";

export function registerRunsTrace(runs: Command): void {
  const trace = runs
    .command("trace <run-id>")
    .description("show a run's tool calls and how each ended")
    .action((runId: string, options: OutputFlags) => runTrace(runId, options));
  addReadFlags(trace);
}

async function runTrace(runId: string, options: OutputFlags): Promise<void> {
  // Read-class format resolves to exactly table | json | yaml — the trace surface.
  const format = readFormat(options) as TraceFormat;

  const [{ connectBackend }, { traceRun }] = await Promise.all([
    import("../../backend.js"),
    import("../../resources/run-trace.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);

  await traceRun(client.stigmer, runId, format);
}
