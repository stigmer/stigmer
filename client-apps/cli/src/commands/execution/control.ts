// `stigmer execution {cancel,terminate,pause,resume} <execution-id>` — lifecycle
// control verbs. Thin handlers: resolve the client, call the control resource,
// render the resulting phase. Mirrors Go's execution_cancel.go / execution_pause.go.

import type { Command } from "commander";
import { ensureAuthenticated } from "../../config/index.js";

interface ReasonFlags {
  reason?: string;
}

export function registerExecutionControl(execution: Command): void {
  execution
    .command("cancel <execution-id>")
    .description("gracefully cancel a running execution")
    .option("--reason <reason>", "reason for cancellation")
    .action((executionId: string, options: ReasonFlags) => runControl("cancel", executionId, options.reason ?? ""));

  execution
    .command("terminate <execution-id>")
    .description("force-stop an execution immediately")
    .option("--reason <reason>", "reason for termination")
    .action((executionId: string, options: ReasonFlags) => runControl("terminate", executionId, options.reason ?? ""));

  execution
    .command("pause <execution-id>")
    .description("pause a running execution")
    .option("--reason <reason>", "reason for pausing")
    .action((executionId: string, options: ReasonFlags) => runControl("pause", executionId, options.reason ?? ""));

  execution
    .command("resume <execution-id>")
    .description("resume a paused execution")
    .action((executionId: string) => runControl("resume", executionId, ""));
}

type ControlVerb = "cancel" | "terminate" | "pause" | "resume";

// Past-tense success wording per verb, matching Go's climsg.Success lines.
const PAST_TENSE: Record<ControlVerb, string> = {
  cancel: "cancelled",
  terminate: "terminated",
  pause: "paused",
  resume: "resumed",
};

async function runControl(verb: ControlVerb, executionId: string, reason: string): Promise<void> {
  const [{ connectBackend }, control, { CommandResult, renderResult }] = await Promise.all([
    import("../../backend.js"),
    import("../../resources/execution-control.js"),
    import("../../output/command-result.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);

  const result = await dispatch(verb, control, client.stigmer, executionId, reason);
  const message = `Execution ${PAST_TENSE[verb]}: ${executionId} (phase: ${result.phase})`;
  renderResult(CommandResult.success(message), "human");
}

function dispatch(
  verb: ControlVerb,
  control: typeof import("../../resources/execution-control.js"),
  client: import("@stigmer/sdk").Stigmer,
  executionId: string,
  reason: string,
): Promise<import("../../resources/execution-control.js").ControlResult> {
  switch (verb) {
    case "cancel":
      return control.cancelExecution(client, executionId, reason);
    case "terminate":
      return control.terminateExecution(client, executionId, reason);
    case "pause":
      return control.pauseExecution(client, executionId, reason);
    case "resume":
      return control.resumeExecution(client, executionId);
  }
}
