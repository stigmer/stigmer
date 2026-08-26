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
// - idempotency_key dedupe: a duplicate of a DELIVERED key (org-scoped, 24h
//   window anchored at delivery) is rejected with ALREADY_EXISTS; a distinct
//   key delivers normally. Both editions enforce this through equivalent
//   DedupeClaimStep pipelines. This was the DD-013 "documented, not fixed"
//   gap — the OSS server never called SetSignalDedupeStore, so dedupe degraded
//   to a no-op; #309 wired the store and this suite asserts the contract
//   ungated. Deliberately NOT asserted here (oss#442, pinned at store/step
//   level in both editions instead — inducing a Temporal send failure or an
//   in-flight race needs surgical control a live server doesn't offer): a
//   FAILED delivery frees the key for the caller's retry, and a same-key
//   request whose delivery is in flight is rejected with the retryable
//   ABORTED rather than ALREADY_EXISTS. (The cloud conformance run
//   does not include this file today — its environment boots no TS runner —
//   so in CI the pin executes against local-execution; it becomes a live
//   cross-edition pin automatically if the cloud lane gains a runner.)
//
// Dedupe test shape: the duplicate is sent while the execution is still
// IN_PROGRESS at the listen gate, using a signal name the gate does NOT match.
// The orchestrator's relaySignal handler forwards any name to the child, where
// an unhandled signal just buffers — the RPC succeeds and the run stays
// gated, so the duplicate deterministically reaches DedupeClaimStep instead of
// bouncing off ValidateSignalable after the run completes. The matching gate
// signal then rides a DIFFERENT key, proving distinct keys pass.
//
// Already covered in the main WorkflowExecution suite (not re-asserted here):
// - sendSignal with empty execution_id -> InvalidArgument; missing execution ->
//   NotFound. The terminal-phase FailedPrecondition is covered by the lifecycle
//   negatives (only PENDING/IN_PROGRESS are signalable).
import { Code } from "@connectrpc/connect";
import {
  ExecutionPhase,
  WorkflowTaskStatus,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
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

describe("WorkflowExecution sendSignal — idempotency_key dedupe", () => {
  it("rejects a duplicate idempotency_key with ALREADY_EXISTS while a distinct key delivers", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionListenWorkflow(org);

    const execution = await clients.workflowExecutionCommand.create(
      makeWorkflowExecution({ org, name: uniqueName("wfx-dedupe"), workflowId }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.workflowExecutionCommand.delete({ value: executionId }));

    // Wait for the listen task to hold the run IN_PROGRESS (poll, don't sleep).
    await awaitTaskStatus(clients, executionId, LISTEN_TASK_NAME, WorkflowTaskStatus.WORKFLOW_TASK_IN_PROGRESS);

    // First delivery with a key: a name the gate does not match, so the child
    // buffers it and the run stays gated (see the header for why this shape).
    const bufferedSignal = "conformance-dedupe-buffered";
    await clients.workflowExecutionCommand.sendSignal({
      executionId,
      signalName: bufferedSignal,
      idempotencyKey: "dedupe-evt-1",
    });

    // Same key again: the claim step rejects it before any re-delivery.
    await expectGrpcCode(
      () =>
        clients.workflowExecutionCommand.sendSignal({
          executionId,
          signalName: bufferedSignal,
          idempotencyKey: "dedupe-evt-1",
        }),
      Code.AlreadyExists,
      "duplicate idempotency_key",
    );

    // A distinct key passes: the matching gate signal completes the run.
    await clients.workflowExecutionCommand.sendSignal({
      executionId,
      signalName: SIGNAL_NAME,
      idempotencyKey: "dedupe-evt-2",
    });

    const final = await awaitTerminal(clients, executionId);
    expect(
      final.status?.phase,
      `the run signaled under a distinct key should COMPLETE; reached ${ExecutionPhase[final.status?.phase ?? 0]}`,
    ).toBe(ExecutionPhase.EXECUTION_COMPLETED);
  });
});
