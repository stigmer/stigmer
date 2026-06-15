// `stigmer execution trace <execution-id>` — show task/tool structure + timing.
// Thin handler: resolve the client and format, delegate to
// resources/execution-trace.ts. Mirrors Go's execution_trace.go.

import type { Command } from "commander";
import { ensureAuthenticated } from "../../config/index.js";
import type { OutputFlags } from "../../output/index.js";
import type { TraceFormat } from "../../resources/execution-trace.js";
import { addReadFlags, readFormat } from "../shared.js";

export function registerExecutionTrace(execution: Command): void {
  const trace = execution
    .command("trace <execution-id>")
    .description("show execution task structure and timing")
    .action((executionId: string, options: OutputFlags) => runTrace(executionId, options));
  addReadFlags(trace);
}

async function runTrace(executionId: string, options: OutputFlags): Promise<void> {
  // Read-class format resolves to exactly table | json | yaml — the trace surface.
  const format = readFormat(options) as TraceFormat;

  const [{ connectBackend }, { traceExecution }] = await Promise.all([
    import("../../backend.js"),
    import("../../resources/execution-trace.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);

  await traceExecution(client.stigmer, executionId, format);
}
