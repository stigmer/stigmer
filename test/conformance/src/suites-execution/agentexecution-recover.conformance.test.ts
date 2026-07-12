// Conformance suite for AgentExecution recover (Class B).
// Domain: agentic / agentexecution — the recover RPC.
//
// recover is the operator's "try this run again" lever for a FAILED execution. The
// conformance suite asserts the *observable* contract (phase lifecycle), not the
// recovery mechanism.
//
// Asserted contract (sourced from controller/recover.go + lifecycle_steps.go):
// - recover of a FAILED execution returns it transitioning back to IN_PROGRESS
//   with status.error cleared, re-dispatches the runner (a fresh LLM turn is
//   consumed), and the run can reach COMPLETED when the failure cause is gone.
// - recover of an already-IN_PROGRESS execution is an idempotent no-op (the
//   alreadyInTargetState branch): it succeeds and the run stays IN_PROGRESS.
//
// Mechanism note (issue #200, fixed): AgentExecution.recover terminates the
// previous Temporal workflow and starts a fresh one — the same strategy
// WorkflowExecution.recover uses. Temporal ResetWorkflowExecution cannot work
// here because the runner activity RETURNS its FAILED result (it does not
// throw), so a reset replays the preserved failure instead of re-dispatching.
// Continuity of completed work is carried by the session's harness state
// (LangGraph thread checkpoint / harness_state_id), not by Temporal history.
//
// Already covered in the main AgentExecution suite (not re-asserted here):
// - recover of a non-FAILED terminal execution -> FailedPrecondition.
// - recover with empty id -> InvalidArgument; missing execution -> NotFound.
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "../harness/mock-llm";
import { anthropicText } from "../harness/mock-llm";
import { makeAgent } from "../support/agents";
import { awaitPhase, makeAgentExecution, requireLlmProxy } from "../support/agentexecutions";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

// Holds a turn open so the run sits observably IN_PROGRESS for the no-op recover
// test; mirrors the main AgentExecution suite's HOLD_MS.
const HOLD_MS = 30_000;

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
});

afterEach(async () => {
  // Release any still-held turn so a lifecycle test's un-preemptable runner
  // activity finishes and frees its session lock before the next test runs.
  mock.releaseHolds();
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

// A valid Agent; returns its id.
async function provisionAgent(org: string): Promise<string> {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent-recover") }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return agent.metadata!.id;
}

describe("AgentExecution recover — happy path", () => {
  it("recovers a FAILED execution back to IN_PROGRESS with the error cleared, then completes", async () => {
    const { org } = await target.provisionTenancy();
    const agentId = await provisionAgent(org);

    // Turn 1: deterministic non-retryable LLM failure (400 is in LangChain's
    // STATUS_NO_RETRY list — fail-fast, no backoff stall).
    mock.enqueueError(400);
    // Turn 2: success after recover re-dispatches the runner activity.
    mock.enqueue(anthropicText("Recovered successfully."));

    const created = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-recover-happy"), agentId }),
    );
    const executionId = created.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    const failed = await awaitPhase(clients, executionId, ExecutionPhase.EXECUTION_FAILED);
    expect(failed.status?.error, "a FAILED execution carries an error message").toBeTruthy();
    expect(mock.consumed(), "the failure turn should be consumed").toBe(1);
    expect(mock.remaining(), "the recovery turn should still be queued").toBe(1);

    const recovered = await clients.agentExecutionCommand.recover({ id: executionId });
    expect(
      recovered.status?.phase,
      `recover should move the execution out of FAILED; got ${ExecutionPhase[recovered.status?.phase ?? 0]}`,
    ).not.toBe(ExecutionPhase.EXECUTION_FAILED);

    const running = await awaitPhase(clients, executionId, ExecutionPhase.EXECUTION_IN_PROGRESS);
    expect(running.status?.error, "recover clears the prior failure's error").toBeFalsy();

    const completed = await awaitPhase(clients, executionId, ExecutionPhase.EXECUTION_COMPLETED);
    expect(completed.status?.error, "a completed run carries no error").toBeFalsy();

    // Proof recovery re-dispatched: the recovery turn was consumed. Before the
    // fix (issue #200) consumed stayed at 1 and remaining stayed at 1 — the run
    // was orphaned at IN_PROGRESS with no fresh LLM call.
    expect(mock.consumed(), "recover must consume the queued success turn").toBe(2);
    expect(mock.remaining(), "all queued turns should be consumed").toBe(0);
  });
});

describe("AgentExecution recover — idempotency", () => {
  it("is an idempotent no-op on an already-IN_PROGRESS execution", async () => {
    const { org } = await target.provisionTenancy();
    const agentId = await provisionAgent(org);

    // A held turn keeps the run IN_PROGRESS across the poll-and-act window.
    mock.enqueue(anthropicText("Working..."), { delayMs: HOLD_MS });
    const created = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-recover"), agentId }),
    );
    const executionId = created.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    await awaitPhase(clients, executionId, ExecutionPhase.EXECUTION_IN_PROGRESS);

    // recover on a running execution is a no-op: it succeeds and stays IN_PROGRESS.
    const recovered = await clients.agentExecutionCommand.recover({ id: executionId });
    expect(recovered.status?.phase, "recover on a running execution stays IN_PROGRESS").toBe(
      ExecutionPhase.EXECUTION_IN_PROGRESS,
    );

    // Settle the run.
    await clients.agentExecutionCommand.cancel({ id: executionId });
    await awaitPhase(clients, executionId, ExecutionPhase.EXECUTION_CANCELLED);
  });
});
