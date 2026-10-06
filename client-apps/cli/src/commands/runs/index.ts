// `stigmer runs …` — lifecycle and observability for agent runs (aex_).
//
// The group is plural because the singular `stigmer run` starts a run (`run
// <agent>`), the top-level `logs` reads the local stack
// and the top-level `resume` reopens a session; `runs` is the one plural group
// the CLI has.
//
// Mirrors Go's NewExecutionCommand (cmd/stigmer/root/execution.go). Each
// subcommand is a thin handler that resolves the backend client and delegates to
// a resources/ module; heavy modules load lazily inside the actions.

import type { Command } from "commander";
import { registerRunsApprove } from "./approve.js";
import { registerRunsControl } from "./control.js";
import { registerRunsLogs } from "./logs.js";
import { registerRunsTrace } from "./trace.js";

export function registerRuns(program: Command): void {
  const runs = program
    .command("runs")
    .description("manage run lifecycle and observability (run IDs: aex_)");

  registerRunsControl(runs);
  registerRunsLogs(runs);
  registerRunsTrace(runs);
  registerRunsApprove(runs);
}
