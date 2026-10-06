// `stigmer runs …` — lifecycle and observability for agent and workflow runs.
// The run type is auto-detected from the ID prefix (aex_ vs wex_), so a single
// command group serves both families.
//
// The group is plural because the singular `stigmer run` starts a run (`run
// <agent>`, `run workflow <ref>`), the top-level `logs` reads the local stack
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
    .description("manage run lifecycle and observability (agent: aex_, workflow: wex_)");

  registerRunsControl(runs);
  registerRunsLogs(runs);
  registerRunsTrace(runs);
  registerRunsApprove(runs);
}
