/**
 * The eval's workflow as the domain starts and stops it: one suite
 * workflow per eval (temporal/evals/names.ts), started by create under a
 * deterministic id, so a retried start finds the workflow already running
 * and counts as success, and cancelled by cancel through Temporal's own
 * cancellation, which the workflow turns into a partial "cancelled" eval
 * with the results of the tries that finished.
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
  RUN_PLUGIN_EVAL_WORKFLOW_TYPE,
  runPluginEvalWorkflowId,
} from "../../temporal/evals/names.js";

/** The bound on a start or a cancel, in milliseconds. */
export const PLUGIN_EVAL_WORKFLOW_DEADLINE_MS = 5_000;

/**
 * The longest a suite may run before the engine stops it: a full suite at
 * concurrency 1 (a thousand tries of up to an hour each, the format's
 * ceiling) does not fit any bound, so this one only ends a suite whose
 * workflow is stuck; the eval's cost ceiling is what bounds its spend.
 */
const RUN_PLUGIN_EVAL_EXECUTION_TIMEOUT = "30 days";

/** The suite workflow's one argument. */
export interface RunPluginEvalInput {
  readonly evalId: string;
}

/** No engine is connected: nothing can be started or stopped yet. */
export class PluginEvalEngineUnavailableError extends Error {
  constructor() {
    super("no engine connection");
    this.name = "PluginEvalEngineUnavailableError";
  }
}

export interface PluginEvalWorkflows {
  /** Starts the eval's workflow; an already-started one is success. */
  start(evalId: string): Promise<void>;
  /**
   * Asks the eval's workflow to cancel. "not-found" when no workflow runs
   * under its id (never started, or already closed).
   */
  cancel(evalId: string): Promise<"requested" | "not-found">;
}

export interface TemporalPluginEvalWorkflowsDeps {
  /** The engine's current client; undefined until its first connect. */
  readonly client: () => Client | undefined;
  /** The queue the eval's workers poll. */
  readonly taskQueue: string;
  /** Defaults to PLUGIN_EVAL_WORKFLOW_DEADLINE_MS; tests shorten it. */
  readonly deadlineMs?: number;
}

export function newTemporalPluginEvalWorkflows(
  deps: TemporalPluginEvalWorkflowsDeps,
): PluginEvalWorkflows {
  const deadlineMs = deps.deadlineMs ?? PLUGIN_EVAL_WORKFLOW_DEADLINE_MS;
  const connected = (): Client => {
    const client = deps.client();
    if (client === undefined) {
      throw new PluginEvalEngineUnavailableError();
    }
    return client;
  };
  return {
    async start(evalId) {
      const client = connected();
      const input: RunPluginEvalInput = { evalId };
      try {
        await client.connection.withDeadline(Date.now() + deadlineMs, () =>
          client.workflow.start(RUN_PLUGIN_EVAL_WORKFLOW_TYPE, {
            workflowId: runPluginEvalWorkflowId(evalId),
            taskQueue: deps.taskQueue,
            workflowIdReusePolicy: "REJECT_DUPLICATE",
            workflowExecutionTimeout: RUN_PLUGIN_EVAL_EXECUTION_TIMEOUT,
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
          client.workflow.getHandle(runPluginEvalWorkflowId(evalId)).cancel(),
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
