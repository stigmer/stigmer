// Conformance suite for WorkflowExecution `run_workflow` child naming (Class B).
// Domain: agentic / workflowexecution — what a workflow's `run_workflow` task
// may name as its child.
//
// The contract pinned here: a workflow cannot start one of the platform's own
// workflow types, the `stigmer/` namespace every type the runner registers
// carries. A child started by `run_workflow` runs on the parent's own task
// queue, so such a name would reach the runner's types directly, outside the
// run the server dispatched. The runner refuses the name when it reaches the
// task, before any child is started (tasks ahead of it run as usual), and the
// execution ends FAILED with a reason that names the task and the type. The
// refusal reaches the user through the execution's status.
//
// Deliberately out of scope here:
// - a `run_workflow` naming an ordinary child, whose resolution to a Workflow
//   resource is not part of today's contract (the task starts a Temporal type
//   by that name, and none is registered for user workflows);
// - the runner's registered set itself, which a runner unit pins
//   (`backend/services/runner/src/workflows/__tests__/barrel.test.ts`) along
//   with a Temporal E2E (`src/__tests__/dispatch-surface-e2e.test.ts`),
//   because it is read at the Temporal wire, not through execution status.
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "../support/naming";
import { awaitTerminal, makeWorkflowExecution } from "../support/workflowexecutions";
import { RUN_WORKFLOW_TASK_NAME, makeRunWorkflowWorkflow } from "../support/workflows";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

async function runChildNaming(childWorkflow: string) {
  const { org } = await target.provisionTenancy();
  const workflow = await clients.workflowCommand.create(
    makeRunWorkflowWorkflow({ org, name: uniqueName("wf-run"), childWorkflow }),
  );
  fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));
  const execution = await clients.workflowExecutionCommand.create(
    makeWorkflowExecution({ org, name: uniqueName("wfx-run"), workflowId: workflow.metadata!.id }),
  );
  const executionId = execution.metadata!.id;
  fixtures.defer(() => clients.workflowExecutionCommand.delete({ value: executionId }));
  return awaitTerminal(clients, executionId);
}

describe("WorkflowExecution run_workflow — platform workflow types", () => {
  it.each([
    "stigmer/workflow/execute",
    "stigmer/workflow/execute-from-execution",
    "stigmer/mcp-server/connect",
  ])("a run_workflow naming %s fails the execution without starting it", async (childWorkflow) => {
    const final = await runChildNaming(childWorkflow);

    expect(
      final.status?.phase,
      `reached ${ExecutionPhase[final.status?.phase ?? 0]} (status.error: ${JSON.stringify(final.status?.error ?? "")})`,
    ).toBe(ExecutionPhase.EXECUTION_FAILED);
    expect(final.status?.error ?? "").toContain(
      `Run task '${RUN_WORKFLOW_TASK_NAME}': '${childWorkflow}' is a platform workflow type, and a workflow cannot start one`,
    );
  });
});
