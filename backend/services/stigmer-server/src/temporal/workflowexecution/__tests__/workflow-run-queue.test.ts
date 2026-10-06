/**
 * Pins newWorkflowRunQueue (dispatch.ts): a workflow run has a queue of its
 * own — the one its agent_call children share — only under execution
 * routing. Under global routing the run shares the runner pool and the
 * answer is "", so a child turn dispatches as any turn does instead of
 * waiting on a queue no worker polls.
 */
import { describe, expect, it } from "vitest";

import {
  WORKFLOW_DEFAULT_EXECUTION_TARGET_LOCAL,
  WORKFLOW_ROUTING_EXECUTION,
  WORKFLOW_ROUTING_GLOBAL,
  WorkflowExecutionTemporalConfig,
} from "../../../domain/workflowrun/temporal/config.js";
import { newWorkflowRunQueue } from "../dispatch.js";

function configRouting(routing: string): WorkflowExecutionTemporalConfig {
  return new WorkflowExecutionTemporalConfig(
    "workflow_execution_stigmer",
    "stigmer_runner",
    routing,
    WORKFLOW_DEFAULT_EXECUTION_TARGET_LOCAL,
  );
}

describe("newWorkflowRunQueue", () => {
  it("answers the run's own queue under execution routing", () => {
    const queueOf = newWorkflowRunQueue(
      configRouting(WORKFLOW_ROUTING_EXECUTION),
    );
    expect(queueOf("wfx_1")).toBe("wfexec:wfx_1");
  });

  it("answers no queue under global routing", () => {
    const queueOf = newWorkflowRunQueue(configRouting(WORKFLOW_ROUTING_GLOBAL));
    expect(queueOf("wfx_1")).toBe("");
  });

  it("answers no queue for a link that names no run", () => {
    const queueOf = newWorkflowRunQueue(
      configRouting(WORKFLOW_ROUTING_EXECUTION),
    );
    expect(queueOf("")).toBe("");
  });
});
