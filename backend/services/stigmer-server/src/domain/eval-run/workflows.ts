/**
 * The eval's workflow as the domain starts and stops it: one suite
 * workflow per eval (temporal/evals/names.ts), started by create under a
 * deterministic id, so a retried start finds the workflow already running
 * and counts as success, and cancelled by cancel through Temporal's own
 * cancellation, which the workflow turns into a partial "cancelled" eval
 * with the results of the tries that finished.
 *
 * An agent eval's workflow is started and stopped the same way, under its
 * own type and id (temporal/evals/names.ts RUN_AGENT_EVAL_WORKFLOW_TYPE),
 * through the same port.
 *
 * Bounded as the grading observer's start is (domain/score/grading-observer.ts):
 * every call carries the connection's deadline, so an unreachable engine
 * costs a create or a cancel at most that.
 *
 * Proven by __tests__/workflows.test.ts.
 */
import type { Client } from "@temporalio/client";
import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
} from "@temporalio/client";

import {
  RUN_EVAL_RUN_WORKFLOW_TYPE,
  runEvalRunWorkflowId,
} from "../../temporal/evals/names.js";
import type { RunEvalRunInput } from "../../temporal/evals/names.js";

/** The bound on a start or a cancel, in milliseconds. */
export const EVAL_RUN_WORKFLOW_DEADLINE_MS = 5_000;

/**
 * The longest a suite may run before the engine stops it, 30 days: a full
 * suite at concurrency 1 (a thousand tries of up to an hour each, the
 * format's ceiling) does not fit any bound, so this one only ends a suite
 * whose workflow is stuck; the eval's cost ceiling is what bounds its
 * spend. A workflow the engine stops writes no end, so an eval still
 * pending or running past it is answered failed (steps.ts
 * evalRunOutlivedItsWorkflow).
 */
export const EVAL_RUN_EXECUTION_TIMEOUT_MS = 30 * 24 * 60 * 60 * 1000;

/** The suite workflow's one argument (its wire type lives with its names). */
export type { RunEvalRunInput } from "../../temporal/evals/names.js";

/** No engine is connected: nothing can be started or stopped yet. */
export class EvalRunEngineUnavailableError extends Error {
  constructor() {
    super("no engine connection");
    this.name = "EvalRunEngineUnavailableError";
  }
}

export interface EvalRunWorkflows {
  /** Starts the eval's workflow; an already-started one is success. */
  start(evalId: string): Promise<void>;
  /**
   * Asks the eval's workflow to cancel. "not-found" when no workflow runs
   * under its id (never started, or already closed).
   */
  cancel(evalId: string): Promise<"requested" | "not-found">;
}

export interface TemporalEvalRunWorkflowsDeps {
  /** The engine's current client; undefined until its first connect. */
  readonly client: () => Client | undefined;
  /** The queue the eval's workers poll. */
  readonly taskQueue: string;
  /** Defaults to EVAL_RUN_WORKFLOW_DEADLINE_MS; tests shorten it. */
  readonly deadlineMs?: number;
  /** The suite workflow's type and id; a plugin eval's when absent. */
  readonly workflow?: {
    readonly type: string;
    readonly idOf: (evalId: string) => string;
  };
}

export function newTemporalEvalRunWorkflows(
  deps: TemporalEvalRunWorkflowsDeps,
): EvalRunWorkflows {
  const deadlineMs = deps.deadlineMs ?? EVAL_RUN_WORKFLOW_DEADLINE_MS;
  const workflow = deps.workflow ?? { type: RUN_EVAL_RUN_WORKFLOW_TYPE, idOf: runEvalRunWorkflowId };
  const connected = (): Client => {
    const client = deps.client();
    if (client === undefined) {
      throw new EvalRunEngineUnavailableError();
    }
    return client;
  };
  return {
    async start(evalId) {
      const client = connected();
      const input: RunEvalRunInput = { evalId };
      try {
        await client.connection.withDeadline(Date.now() + deadlineMs, () =>
          client.workflow.start(workflow.type, {
            workflowId: workflow.idOf(evalId),
            taskQueue: deps.taskQueue,
            workflowIdReusePolicy: "REJECT_DUPLICATE",
            workflowExecutionTimeout: EVAL_RUN_EXECUTION_TIMEOUT_MS,
            args: [input],
          }),
        );
      } catch (error) {
        if (error instanceof WorkflowExecutionAlreadyStartedError) {
          return;
        }
        throw error;
      }
    },
    async cancel(evalId) {
      const client = connected();
      try {
        await client.connection.withDeadline(Date.now() + deadlineMs, () =>
          client.workflow.getHandle(workflow.idOf(evalId)).cancel(),
        );
        return "requested";
      } catch (error) {
        if (error instanceof WorkflowNotFoundError) {
          return "not-found";
        }
        throw error;
      }
    },
  };
}
