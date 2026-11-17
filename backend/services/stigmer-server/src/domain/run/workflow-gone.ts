/**
 * The one write for "this run's workflow is gone": the run is ended as
 * FAILED, so its session stops reading running, its queued messages start
 * the next turn and its sandbox may sleep (stigmer#3120).
 *
 * Two callers: the stalled-run checker (stalled-runs.ts), for a working
 * run whose workflow the engine reports closed or absent, and an answer to
 * a waiting tool use whose workflow cannot be signalled
 * (session/hitl/answer.ts).
 *
 * The write is row-locked and conditional (updateRunAppendingEvents): it
 * reads the stored run under its session's lock, and a run whose phase has
 * left the phases the caller saw (it ended on its own, or a person stopped
 * it, while the engine was asked) is not written at all. A store write has
 * no "no change" outcome, so the change aborts with a module-private
 * sentinel, as the writer aborts on a missing row, and this reports that
 * nothing was written. A run removed meanwhile reads the same.
 *
 * It records the ending as the workflow's own failure write does
 * (temporal/agentexecution/workflows/invoke-agent-execution.ts): phase
 * FAILED, `stop_cause` `failed` with detail kind `internal` ("a fault of
 * the platform", session/v1/event_content.proto), the end time, and the
 * pinned error copy. The rest of the status, the file record included, is
 * kept, so an undo of the run's files can still be put back. The
 * transition's events (the session's error and the run's status) come
 * from the committed write (session/events/transitions.ts).
 *
 * Only a write notifies the status observers (status-observers.ts lists
 * this as a notifying site); one of them starts the session's queued turn
 * (queued-turn.ts). Each write is counted on `stigmer.run.workflow_gone`
 * (observability/run-workflow-gone-metrics.ts) and logged.
 *
 * Proven by __tests__/workflow-gone.test.ts, and through
 * its callers by __tests__/stalled-runs.test.ts and
 * session/hitl/__tests__/methods.test.ts.
 */
import { create } from "@bufbuild/protobuf";

import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { StigmerStopDetailSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_content_pb";

import {
  recordRunWorkflowGone,
  type WorkflowGoneFound,
} from "../../observability/run-workflow-gone-metrics.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { RunEventWriteDeps } from "../session/events/run-writes.js";
import { updateRunAppendingEvents } from "../session/events/run-writes.js";
import { sessionIdOfRun } from "../session/events/transitions.js";
import { notifyStatusObservers } from "./status-observers.js";
import type { StatusObserverDeps } from "./status-observers.js";

/** The error copy a run whose workflow is gone ends with (wire contract since the approval path's reconcile). */
export const WORKFLOW_GONE_ERROR =
  "Workflow backing this execution is no longer running. Execution has been marked as failed.";

/** The ending's cause and its detail kind, as the workflow's own failure write names a platform fault. */
export const WORKFLOW_GONE_STOP_CAUSE = "failed";
export const WORKFLOW_GONE_STOP_KIND = "internal";

export type WorkflowGoneDeps = RunEventWriteDeps & StatusObserverDeps;

/** What the write did: ended the run (with the phase it left), or nothing. */
export type WorkflowGoneOutcome =
  | {
      readonly written: true;
      readonly run: Run;
      readonly previousPhase: RunPhase;
    }
  | { readonly written: false };

/** Aborts the write when the stored run has left the expected phases (module header). */
class RunLeftExpectedPhases extends Error {
  constructor() {
    super("the run left the expected phases");
    this.name = "RunLeftExpectedPhases";
  }
}

/**
 * Ends the run as FAILED when its stored phase is still one of
 * `expectedPhases`; otherwise writes nothing. `found` is what the engine
 * answered, for the count. Store faults throw.
 */
export async function failRunWithoutWorkflow(
  deps: WorkflowGoneDeps,
  runId: string,
  expectedPhases: ReadonlyArray<RunPhase>,
  found: WorkflowGoneFound,
): Promise<WorkflowGoneOutcome> {
  let result: Awaited<ReturnType<typeof updateRunAppendingEvents>>;
  try {
    result = await updateRunAppendingEvents(deps, runId, (run) => {
      if (
        !expectedPhases.includes(
          run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED,
        )
      ) {
        throw new RunLeftExpectedPhases();
      }
      endAsWorkflowGone(run);
    });
  } catch (error) {
    if (
      error instanceof RunLeftExpectedPhases ||
      error instanceof ResourceNotFoundError
    ) {
      return { written: false };
    }
    throw error;
  }
  const { run, previousPhase } = result;
  recordRunWorkflowGone({ phase: phaseAttributeOf(previousPhase), found });
  deps.logger.warn("run ended: its workflow is gone", {
    runId,
    sessionId: sessionIdOfRun(run),
    org: run.metadata?.org ?? "",
    previousPhase: RunPhase[previousPhase],
    found,
  });
  await notifyStatusObservers(deps, run, previousPhase, RunPhase.RUN_FAILED);
  return { written: true, run, previousPhase };
}

/** The ending, stamped on the stored run in place (module header). */
function endAsWorkflowGone(run: Run): void {
  run.status ??= create(RunStatusSchema);
  const status = run.status;
  status.phase = RunPhase.RUN_FAILED;
  status.error = WORKFLOW_GONE_ERROR;
  status.stopCause = WORKFLOW_GONE_STOP_CAUSE;
  status.stopDetail = create(StigmerStopDetailSchema, {
    kind: WORKFLOW_GONE_STOP_KIND,
  });
  // lifecycle.ts's stamp: UTC to the second.
  status.completedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** `RUN_IN_PROGRESS` → `in_progress`: the counter's bounded phase attribute. */
function phaseAttributeOf(phase: RunPhase): string {
  return (RunPhase[phase] ?? "RUN_PHASE_UNSPECIFIED")
    .replace(/^RUN_/, "")
    .toLowerCase();
}
