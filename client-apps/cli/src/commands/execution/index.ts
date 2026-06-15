// `stigmer execution …` — lifecycle and observability for agent and workflow
// executions. The execution type is auto-detected from the ID prefix (aex_ vs
// wex_), so a single command group serves both families.
//
// Mirrors Go's NewExecutionCommand (cmd/stigmer/root/execution.go). Each
// subcommand is a thin handler that resolves the backend client and delegates to
// a resources/ module; heavy modules load lazily inside the actions (DD-001).

import type { Command } from "commander";
import { registerExecutionApprove } from "./approve.js";
import { registerExecutionControl } from "./control.js";
import { registerExecutionLogs } from "./logs.js";
import { registerExecutionTrace } from "./trace.js";

export function registerExecution(program: Command): void {
  const execution = program
    .command("execution")
    .description("manage execution lifecycle and observability (agent: aex_, workflow: wex_)");

  registerExecutionControl(execution);
  registerExecutionLogs(execution);
  registerExecutionTrace(execution);
  registerExecutionApprove(execution);
}
