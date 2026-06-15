// Conformance suite for AgentExecution recover (Class B).
// Domain: agentic / agentexecution — the recover RPC.
//
// recover is the operator's "try this run again" lever for a FAILED execution. The
// conformance suite asserts the *observable* contract (phase lifecycle), not the
// recovery mechanism.
//
// What this file asserts today:
// - recover of an already-IN_PROGRESS execution is an idempotent no-op (the
//   alreadyInTargetState branch): it succeeds and the run stays IN_PROGRESS.
//
// What is DEFERRED (documented deficiency, see the Session-13 checkpoint / DD-013):
// the end-to-end FAILED -> recover -> COMPLETED happy path. Unlike
// WorkflowExecution.recover (which terminates the old orchestrator and starts a
// fresh one — clean and deterministic), AgentExecution.recover uses Temporal's
// ResetWorkflowExecution to "the last WorkflowTaskCompleted". When an agent fails
// on its first LLM call, the deep-agent activity *returns* a FAILED result (it does
// not throw) and the workflow then returns an error (invoke_workflow_impl.go), so
// the failed activity result is baked into history. Resetting to the last completed
// workflow-task replays that preserved result instead of re-dispatching the
// activity — so no fresh LLM call is made and the run never progresses. The DB is
// flipped to IN_PROGRESS but Temporal does nothing further, orphaning the execution
// in IN_PROGRESS. Proven by a mock-LLM consumed-count probe: after recover the
// recovery turn is never consumed (consumed=1, remaining=1).
//
// Two correctness notes from this investigation:
// 1. A prerequisite RequestId bug WAS fixed this session: the ResetWorkflowExecution
//    request omitted the required RequestId, so recover failed with an Internal
//    "RequestId is not set on request" before it could even attempt the reset. That
//    fix is correct independent of the deeper orphaning issue.
// 2. The orphaning is a recovery-mechanism design issue (reset vs. start-fresh),
//    deferred to a focused follow-up rather than redesigned mid-session. Asserting
//    the FAILED->IN_PROGRESS flip here would bless a half-behavior (an orphaned run)
//    as contract, so this file deliberately does not assert it.
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

describe("AgentExecution recover", () => {
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
