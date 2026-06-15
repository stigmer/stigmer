// Conformance suite for WorkflowExecution recover (Class B).
// Domain: agentic / workflowexecution — the recover RPC and the lifecycle a
// recovered execution goes through.
//
// recover is the operator's "try this run again" lever for a FAILED execution.
// In the Go server it terminates any stuck Temporal orchestrator, re-resolves the
// execution context from current config, and starts a fresh orchestrator
// (recoveryMode) that replays completed task outputs and resumes from the first
// incomplete/failed task; the phase returns to IN_PROGRESS and the error clears.
// The conformance suite asserts the *observable* contract (phase lifecycle + the
// cleared error + the eventual terminal state), not the terminate/restart vs.
// checkpoint-reset mechanism — that internal difference from AgentExecution.recover
// is an implementation detail a black-box client never sees.
//
// Fixture strategy: the failure must be deterministic, hermetic, and sub-second so
// the test never races a timeout or depends on an external service. The
// `raise_error` task (support/workflows.ts makeRaiseErrorWorkflow) satisfies all
// three — it always throws, needs no LLM/MCP/HTTP/timer, and fails immediately.
// Its re-failure after recover is a *positive* signal: a fresh orchestrator ran
// the same spec and hit the same raise, proving recovery actually dispatched a new
// run rather than no-opping. (A self-healing fixture — one that fails then
// completes — would need either runtime state the engine re-resolves away on
// recover, or external mock state; raise_error keeps the test honest and simple.)
//
// Asserted contract (sourced from controller/recover.go + lifecycle_steps.go):
// - recover of a FAILED execution returns it transitioning back to IN_PROGRESS
//   with status.error cleared, accepts the optional `reason`, and re-runs the
//   workflow to a fresh terminal state.
// - recover of an already-IN_PROGRESS execution is an idempotent no-op
//   (ValidateRecoverableStep's alreadyInTargetState branch): it succeeds and the
//   running execution is untouched.
//
// Already covered in the main WorkflowExecution suite (not re-asserted here):
// - recover of a non-FAILED terminal execution -> FailedPrecondition.
// - recover with empty id -> InvalidArgument; missing execution -> NotFound
//   (the latter two are the shared lifecycle negatives; recover shares the
//   proto-validated `id` field with cancel/pause).
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "../support/naming";
import { awaitPhase, awaitTerminal, makeWorkflowExecution } from "../support/workflowexecutions";
import { makeRaiseErrorWorkflow, makeWaitWorkflow } from "../support/workflows";
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

// A raise_error Workflow that always fails sub-second; returns its wfl_ id.
async function provisionRaiseErrorWorkflow(org: string): Promise<string> {
  const workflow = await clients.workflowCommand.create(
    makeRaiseErrorWorkflow({ org, name: uniqueName("wf-raise") }),
  );
  fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));
  return workflow.metadata!.id;
}

// A wait Workflow that holds an execution IN_PROGRESS; returns its wfl_ id.
async function provisionWaitWorkflow(org: string): Promise<string> {
  const workflow = await clients.workflowCommand.create(
    makeWaitWorkflow({ org, name: uniqueName("wf-wait"), waitSeconds: 30 }),
  );
  fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));
  return workflow.metadata!.id;
}

// Create an execution against a workflow; returns its wex_ id.
async function createExecution(org: string, workflowId: string): Promise<string> {
  const execution = await clients.workflowExecutionCommand.create(
    makeWorkflowExecution({ org, name: uniqueName("wfx-recover"), workflowId }),
  );
  fixtures.defer(() => clients.workflowExecutionCommand.delete({ value: execution.metadata!.id }));
  return execution.metadata!.id;
}

describe("WorkflowExecution recover — happy path", () => {
  it("recovers a FAILED execution back to IN_PROGRESS with the error cleared, then re-runs to terminal", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionRaiseErrorWorkflow(org);
    const executionId = await createExecution(org, workflowId);

    // The raise_error task fails the run deterministically.
    const failed = await awaitPhase(clients, executionId, ExecutionPhase.EXECUTION_FAILED);
    expect(failed.status?.error, "a FAILED execution carries an error message").toBeTruthy();

    // recover terminates the failed orchestrator and starts a fresh one. The
    // optional `reason` is accepted; the returned execution leaves FAILED.
    const recovered = await clients.workflowExecutionCommand.recover({
      id: executionId,
      reason: "conformance recovery",
    });
    expect(
      recovered.status?.phase,
      `recover should move the execution out of FAILED; got ${ExecutionPhase[recovered.status?.phase ?? 0]}`,
    ).not.toBe(ExecutionPhase.EXECUTION_FAILED);

    // The fresh orchestrator clears the prior error and re-enters the running
    // lifecycle; observe IN_PROGRESS, then the error is empty at that point.
    const running = await awaitPhase(clients, executionId, ExecutionPhase.EXECUTION_IN_PROGRESS);
    expect(running.status?.error, "recover clears the prior failure's error").toBeFalsy();

    // The same spec re-fails on the fresh orchestrator — proof recovery actually
    // dispatched a new run rather than returning a stale terminal state.
    const reFailed = await awaitTerminal(clients, executionId);
    expect(
      reFailed.status?.phase,
      `the recovered raise_error run re-fails; got ${ExecutionPhase[reFailed.status?.phase ?? 0]}`,
    ).toBe(ExecutionPhase.EXECUTION_FAILED);
  });

  it("is an idempotent no-op on an already-IN_PROGRESS execution", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionWaitWorkflow(org);
    const executionId = await createExecution(org, workflowId);

    await awaitPhase(clients, executionId, ExecutionPhase.EXECUTION_IN_PROGRESS);

    // recover on a running execution hits the alreadyInTargetState branch: it
    // succeeds without restarting and the execution stays IN_PROGRESS.
    const recovered = await clients.workflowExecutionCommand.recover({ id: executionId });
    expect(recovered.status?.phase, "recover on a running execution is a no-op that stays IN_PROGRESS").toBe(
      ExecutionPhase.EXECUTION_IN_PROGRESS,
    );

    // The execution is still genuinely running afterward (not terminated by the
    // no-op recover); stop the timer to clean up.
    const stillRunning = await clients.workflowExecutionQuery.get({ value: executionId });
    expect(stillRunning.status?.phase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);
    await clients.workflowExecutionCommand.cancel({ id: executionId });
  });
});
