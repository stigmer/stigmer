// `stigmer runs {cancel,terminate,pause,resume} <run-id>` — lifecycle
// control verbs. Thin handlers: resolve the client, call the control resource,
// render the resulting phase (`-o json`: the run, its phase, and for cancel
// the turns it stopped).
// cancel stops the run's whole conversation (resources/run-control.ts), takes
// no reason, and names every turn it stopped.

import type { Command } from "commander";
import { ensureAuthenticated } from "../../config/index.js";
import type { OutputFlags } from "../../output/index.js";
import { addResultFlags, resultFormat } from "../shared.js";

interface ReasonFlags extends OutputFlags {
  reason?: string;
}

export function registerRunsControl(runs: Command): void {
  addResultFlags(
    runs
      .command("cancel <run-id>")
      .description("cancel a run in progress: every unfinished turn of its conversation stops")
      .action((runId: string, options: OutputFlags) => runCancel(runId, options)),
  );

  addResultFlags(
    runs
      .command("terminate <run-id>")
      .description("force-stop a run immediately")
      .option("--reason <reason>", "reason for termination")
      .action((runId: string, options: ReasonFlags) => runControl("terminate", runId, options)),
  );

  addResultFlags(
    runs
      .command("pause <run-id>")
      .description("pause a run in progress")
      .option("--reason <reason>", "reason for pausing")
      .action((runId: string, options: ReasonFlags) => runControl("pause", runId, options)),
  );

  addResultFlags(
    runs
      .command("resume <run-id>")
      .description("resume a paused run")
      .action((runId: string, options: OutputFlags) => runControl("resume", runId, options)),
  );
}

type ControlVerb = "terminate" | "pause" | "resume";

// Past-tense success wording per verb.
const PAST_TENSE: Record<ControlVerb, string> = {
  terminate: "terminated",
  pause: "paused",
  resume: "resumed",
};

async function runCancel(runId: string, options: OutputFlags): Promise<void> {
  const format = resultFormat(options);
  const [{ connectBackend }, control, { CommandResult, renderResult }] = await Promise.all([
    import("../../backend.js"),
    import("../../resources/run-control.js"),
    import("../../output/command-result.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);

  const result = await control.cancelRun(client.stigmer, runId);
  if (result.wasAlreadyTerminal) {
    renderResult(
      CommandResult.warning(`Run already ended: ${runId} (phase: ${result.phase})`).withData({ runId, phase: result.phase, stoppedRunIds: [] }),
      format,
    );
    return;
  }
  const stopped = result.stoppedRunIds.length > 0 ? `; stopped: ${result.stoppedRunIds.join(", ")}` : "";
  renderResult(
    CommandResult.success(`Run cancelled: ${runId} (phase: ${result.phase}${stopped})`).withData({
      runId,
      phase: result.phase,
      stoppedRunIds: result.stoppedRunIds,
    }),
    format,
  );
}

async function runControl(verb: ControlVerb, runId: string, options: ReasonFlags): Promise<void> {
  const format = resultFormat(options);
  const [{ connectBackend }, control, { CommandResult, renderResult }] = await Promise.all([
    import("../../backend.js"),
    import("../../resources/run-control.js"),
    import("../../output/command-result.js"),
  ]);

  const client = connectBackend();
  ensureAuthenticated(client.config);

  const result = await dispatch(verb, control, client.stigmer, runId, options.reason ?? "");
  const message = `Run ${PAST_TENSE[verb]}: ${runId} (phase: ${result.phase})`;
  renderResult(CommandResult.success(message).withData({ runId, phase: result.phase }), format);
}

function dispatch(
  verb: ControlVerb,
  control: typeof import("../../resources/run-control.js"),
  client: import("@stigmer/client").Stigmer,
  runId: string,
  reason: string,
): Promise<import("../../resources/run-control.js").ControlResult> {
  switch (verb) {
    case "terminate":
      return control.terminateRun(client, runId, reason);
    case "pause":
      return control.pauseRun(client, runId, reason);
    case "resume":
      return control.resumeRun(client, runId);
  }
}
