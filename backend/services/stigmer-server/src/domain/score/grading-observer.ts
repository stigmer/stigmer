/**
 * The grading observer: the core's own run-status observer
 * (extensions/status-hooks.ts), composed after every extension's so the
 * hosted edition's billing settle and channel nudge keep their timing. On
 * a run's move to COMPLETED it starts the grading workflow
 * (temporal/grading/) for that run, and nothing else: the run's own
 * workflow stays byte-identical.
 *
 * Observers run after the run's write commits and before its broadcast
 * (domain/run/status-observers.ts), so whatever this awaits delays the
 * person's view of the finished run. The start is therefore bounded by
 * `GRADING_START_DEADLINE_MS` through the connection's own deadline, the
 * manager's idiom (temporal/manager.ts), and an unreachable engine costs
 * at most that.
 *
 * A start that cannot happen (no engine yet, a refusal, the deadline) is
 * recorded as a not-graded run-health score through the score's create
 * chain, so the run reads "not graded" with a reason rather than nothing.
 * "Already started" is success: the workflow id refuses duplicates, and a
 * completed run never completes again. Nothing here fails the transition:
 * a throw is logged by the notifier and the run is unaffected.
 *
 * A judge run (domain/score/judge/judge-run.ts) is never graded: grading
 * the grader would spend a judge on every judge.
 *
 * Proven by __tests__/grading-observer.test.ts.
 */
import type { Client } from "@temporalio/client";
import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client";

import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";

import type { Logger } from "../../boot/logger.js";
import type { RunStatusObserver } from "../../extensions/status-hooks.js";
import { recordRunHealth } from "../../temporal/grading/activities.js";
import type { GradingTemporalConfig } from "../../temporal/grading/config.js";
import {
  GRADE_RUN_WORKFLOW_TYPE,
  gradeRunWorkflowId,
} from "../../temporal/grading/names.js";
import { GRADING_NOT_STARTED_REASON } from "./constants.js";
import { isJudgeRun } from "./judge/judge-run.js";
import type { ScoreRecorder } from "./ports.js";
import { notGradedRunHealthScore } from "./run-health.js";

/** The bound on a grading start, in milliseconds (module header). */
export const GRADING_START_DEADLINE_MS = 2_000;

/**
 * A grading run spans seconds to a couple of minutes; this bounds a stuck
 * one, with room for run health's two retry budgets (five one-minute
 * attempts each, plus backoff), the judge start's ten minutes of capacity
 * retries, the judge run's ten minutes, and the record's twenty minutes of
 * retries (temporal/grading/workflows/grade-run.ts), so no record is cut off
 * mid-flight. A run no grading worker picks up ends here with no score:
 * every composition registers the worker (boot/compose.ts), so that is a
 * deployment without the server's own workers.
 */
const GRADE_RUN_EXECUTION_TIMEOUT = "60 minutes";

export interface GradingObserverDeps {
  /** The engine's current client; undefined until its first connect. */
  readonly client: () => Client | undefined;
  readonly config: GradingTemporalConfig;
  /** Resolved at call time: the in-process clients are wired after the routes. */
  readonly recorder: () => ScoreRecorder;
  readonly logger: Logger;
  /** Defaults to GRADING_START_DEADLINE_MS; tests shorten it. */
  readonly startDeadlineMs?: number;
}

export function newGradingObserver(
  deps: GradingObserverDeps,
): RunStatusObserver {
  const deadlineMs = deps.startDeadlineMs ?? GRADING_START_DEADLINE_MS;
  return async ({ run, newPhase }) => {
    if (newPhase !== RunPhase.RUN_COMPLETED || isJudgeRun(run)) {
      return;
    }
    const runId = run.metadata?.id ?? "";
    const client = deps.client();
    if (client === undefined) {
      await recordNotStarted(deps, run, "no engine connection");
      return;
    }
    try {
      await client.connection.withDeadline(Date.now() + deadlineMs, () =>
        client.workflow.start(GRADE_RUN_WORKFLOW_TYPE, {
          workflowId: gradeRunWorkflowId(runId),
          taskQueue: deps.config.stigmerQueue,
          workflowIdReusePolicy: "REJECT_DUPLICATE",
          workflowExecutionTimeout: GRADE_RUN_EXECUTION_TIMEOUT,
          args: [runId],
        }),
      );
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) {
        return;
      }
      await recordNotStarted(
        deps,
        run,
        error instanceof Error ? error.message : String(error),
      );
    }
  };
}

async function recordNotStarted(
  deps: GradingObserverDeps,
  run: Run,
  cause: string,
): Promise<void> {
  deps.logger.warn("grading could not start; recording the run as not graded", {
    runId: run.metadata?.id ?? "",
    cause,
  });
  await recordRunHealth(
    deps.recorder(),
    notGradedRunHealthScore(run, GRADING_NOT_STARTED_REASON),
  );
}
