// Conformance suite for WorkflowExecution sendSignal (Class B).
// Domain: agentic / workflowexecution — the sendSignal RPC and the `listen` task
// it unblocks.
//
// sendSignal is the external-event entry point into a running workflow: a `listen`
// task blocks on a Temporal signal channel keyed by its signal id, and sendSignal
// delivers a named signal (with an optional payload) that resolves the gate. The
// Go server uses Temporal's SignalWithStart for race-proof delivery (it starts the
// workflow if it has not begun, then signals), and only PENDING / IN_PROGRESS
// executions are signalable.
//
// Fixture: support/workflows.ts makeListenWorkflow — a `listen` (signal mode
// "one") gate followed by a downstream `set_vars`. Fully hermetic (Temporal + the
// TS runner only), exactly like makeWaitWorkflow. The downstream `afterSignal`
// task reaching COMPLETED is the proof the signal unblocked the gate and the run
// continued.
//
// Gate observation is poll-don't-sleep: the suite waits for the listen task to
// reach WORKFLOW_TASK_IN_PROGRESS (the runner broadcasts task status when a task
// starts) before signaling, rather than the fixed sleep the Go integration test
// uses. If a listen task never surfaces as IN_PROGRESS the poll fails fast with a
// precise message.
//
// Asserted contract (sourced from controller/send_signal.go):
// - A signal whose signal_name matches the listen task's signal id unblocks the
//   gate; the listen task and the downstream task complete and the execution
//   reaches EXECUTION_COMPLETED. The optional payload is accepted.
//
// Already covered in the main WorkflowExecution suite (not re-asserted here):
// - sendSignal with empty execution_id -> InvalidArgument; missing execution ->
//   NotFound. The terminal-phase FailedPrecondition is covered by the lifecycle
//   negatives (only PENDING/IN_PROGRESS are signalable).
//
// NOT asserted (capability gap, see the Session-13 checkpoint / DD-013): the
// idempotency_key ALREADY_EXISTS dedupe contract. The SQLite dedupe store exists
// and is unit-tested, but the OSS server never wires it into the controller
// (SetSignalDedupeStore is defined and never called), so DedupeClaimStep
// gracefully degrades to a no-op and a duplicate key is silently re-delivered
// rather than rejected. Asserting ALREADY_EXISTS here would fail against the Go
// server; the contract belongs to an edition that wires the dedupe store, gated
// like the other half-built features (DD-012 child-approval forwarding).
import {
  ExecutionPhase,
  WorkflowTaskStatus,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "../support/naming";
import {
  awaitTaskStatus,
  awaitTerminal,
  makeWorkflowExecution,
  taskByName,
} from "../support/workflowexecutions";
import { LISTEN_AFTER_TASK_NAME, LISTEN_TASK_NAME, makeListenWorkflow } from "../support/workflows";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();

const SIGNAL_NAME = "conformance-signal";

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

// A listen Workflow gating on SIGNAL_NAME; returns its wfl_ id.
async function provisionListenWorkflow(org: string): Promise<string> {
  const workflow = await clients.workflowCommand.create(
    makeListenWorkflow({ org, name: uniqueName("wf-listen"), signalName: SIGNAL_NAME }),
  );
  fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));
  return workflow.metadata!.id;
}

describe("WorkflowExecution sendSignal — happy path", () => {
  it("delivers a matching signal that unblocks the listen task and completes the workflow", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionListenWorkflow(org);

    const execution = await clients.workflowExecutionCommand.create(
      makeWorkflowExecution({ org, name: uniqueName("wfx-signal"), workflowId }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.workflowExecutionCommand.delete({ value: executionId }));

    // Wait for the listen task to register its signal channel (poll, don't sleep).
    await awaitTaskStatus(clients, executionId, LISTEN_TASK_NAME, WorkflowTaskStatus.WORKFLOW_TASK_IN_PROGRESS);

    // Deliver the matching signal with a payload.
    await clients.workflowExecutionCommand.sendSignal({
      executionId,
      signalName: SIGNAL_NAME,
      payload: { message: "hello from conformance" },
    });

    // The gate resolves and the run completes; the downstream task proves it.
    const final = await awaitTerminal(clients, executionId);
    expect(
      final.status?.phase,
      `the signaled run should COMPLETE; reached ${ExecutionPhase[final.status?.phase ?? 0]}`,
    ).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    expect(taskByName(final, LISTEN_TASK_NAME)?.status, "the listen task completes after the signal").toBe(
      WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
    );
    expect(taskByName(final, LISTEN_AFTER_TASK_NAME)?.status, "the downstream task runs after the gate resolves").toBe(
      WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
    );
  });
});
