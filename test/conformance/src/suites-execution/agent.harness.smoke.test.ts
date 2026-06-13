// Execution-engine harness smoke test for AgentExecution (Class B).
// Domain: agentic / agentexecution — proves the agent engine is wired, not the
// domain contract.
//
// This is the AgentExecution counterpart to harness.smoke.test.ts (which uses a
// data-only set_vars WorkflowExecution). Where that one needs no LLM, an agent
// run does — so this is the cheap, permanent guard that the local-go-execution
// target's LLM machinery works end-to-end: Go server -> Temporal dispatch ->
// runner pickup -> hydration -> a real LLM loop served by the mock proxy ->
// terminal status streamed back via gRPC. The whole AgentExecution domain
// contract lives in agentexecution.conformance.test.ts.
//
// Hermetic by construction: the runner is pointed at the in-process mock proxy
// (no API key, no network), artifacts are on local disk, and the checkpointer is
// in-memory. A single Anthropic text turn with stop_reason end_turn is the
// smallest script that reaches EXECUTION_COMPLETED.
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "../harness/mock-llm";
import { anthropicText } from "../harness/mock-llm";
import { makeAgent } from "../support/agents";
import { awaitTerminal, makeAgentExecution, requireLlmProxy } from "../support/agentexecutions";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

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

describe("Execution harness smoke — agent text turn", () => {
  it("runs a single-turn agent end-to-end: PENDING at create, COMPLETED via the runner", async () => {
    const { org } = await target.provisionTenancy();

    const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent-smoke") }));
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

    // One text turn that ends the agent loop. The agent will consume exactly this.
    mock.enqueue(anthropicText("Hello from the conformance mock."));

    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-smoke"), agentId: agent.metadata!.id }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    // create persists then starts Temporal, so the response is PENDING. The
    // transition to COMPLETED proves the full path ran, including the LLM loop
    // against the mock. (We assert the deterministic endpoints, PENDING and
    // COMPLETED, not the sub-second IN_PROGRESS transient.)
    expect(execution.metadata?.id, "create assigns a prefixed execution id").toMatch(/^aex_[0-9a-z]+$/);
    expect(execution.status?.phase, "create returns a PENDING execution").toBe(ExecutionPhase.EXECUTION_PENDING);

    const final = await awaitTerminal(clients, executionId);
    expect(
      final.status?.phase,
      `execution ${executionId} should complete; reached ${ExecutionPhase[final.status?.phase ?? 0]}`,
    ).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    expect(final.status?.startedAt, "started_at is set when the run begins").toBeTruthy();
    expect(final.status?.completedAt, "completed_at is set on completion").toBeTruthy();

    // The agent loop consumed exactly its one scripted turn — no extra LLM calls,
    // none left unserved.
    expect(mock.remaining(), "the single queued turn was consumed").toBe(0);
    expect(mock.consumed(), "exactly one LLM turn was served").toBe(1);
  });
});
