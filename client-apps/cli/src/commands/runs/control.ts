// `stigmer runs {cancel,terminate,pause,resume} <run-id>` — lifecycle
// control verbs. Thin handlers: resolve the client, call the control resource,
// render the resulting phase. Mirrors Go's execution_cancel.go / execution_pause.go.

import type { Command } from "commander";
import { ensureAuthenticated } from "../../config/index.js";

interface ReasonFlags {
  reason?: string;
}

export function registerRunsControl(runs: Command): void {
  runs
    .command("cancel <run-id>")
    .description("gracefully cancel a run in progress")
    .option("--reason <reason>", "reason for cancellation")
    .action((runId: string, options: ReasonFlags) => runControl("cancel", runId, options.reason ?? ""));

  runs
    .command("terminate <run-id>")
    .description("force-stop a run immediately")
    .option("--reason <reason>", "reason for termination")
    .action((runId: string, options: ReasonFlags) => runControl("terminate", runId, options.reason ?? ""));

  runs
    .command("pause <run-id>")
    .description("pause a run in progress")
    .option("--reason <reason>", "reason for pausing")
    .action((runId: string, options: ReasonFlags) => runControl("pause", runId, options.reason ?? ""));

  runs
    .command("resume <run-id>")
    .description("resume a paused run")
    .action((runId: string) => runControl("resume", runId, ""));
}

type ControlVerb = "cancel" | "terminate" | "pause" | "resume";

// Past-tense success wording per verb, matching Go's climsg.Success lines.
const PAST_TENSE: Record<ControlVerb, string> = {
  cancel: "cancelled",
  terminate: "terminated",
  pause: "paused",
  resume: "resumed",
};

async function runControl(verb: ControlVerb, runId: string, reason: string): Promise<void> {
  const [{ connectBackend }, control, { CommandResult, renderResult }] = await Promise.all([
    import("../../backend.js"),
    import("../../resources/run-control.js"),
    import("../../output/command-result.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);

  const result = await dispatch(verb, control, client.stigmer, runId, reason);
  const message = `Run ${PAST_TENSE[verb]}: ${runId} (phase: ${result.phase})`;
  renderResult(CommandResult.success(message), "human");
}

function dispatch(
  verb: ControlVerb,
  control: typeof import("../../resources/run-control.js"),
  client: import("@stigmer/sdk").Stigmer,
  runId: string,
  reason: string,
): Promise<import("../../resources/run-control.js").ControlResult> {
  switch (verb) {
    case "cancel":
      return control.cancelRun(client, runId, reason);
    case "terminate":
      return control.terminateRun(client, runId, reason);
    case "pause":
      return control.pauseRun(client, runId, reason);
    case "resume":
      return control.resumeRun(client, runId);
  }
}
