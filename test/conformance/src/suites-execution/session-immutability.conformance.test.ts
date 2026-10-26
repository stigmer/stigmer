// Conformance suite for Session immutability sentinels (Class B).
// Domain: agentic / session — the harness and execution_target immutability
// validators.
//
// A Session's harness (NATIVE vs CURSOR) and execution_target (LOCAL vs CLOUD)
// each own conversation/workspace state that is not portable once a run has
// started. The server enforces this with two update-time validators. The
// harness locks once the session has a run (stigmer/stigmer#2566: an engine
// that derives its state from the session, as native does, never binds a
// state id) or a bound status.harness_state_id; execution_target locks once
// status.harness_state_id is non-empty. A change past either lock is
// rejected with FAILED_PRECONDITION. Both validators treat the UNSPECIFIED
// enum as its default (harness UNSPECIFIED == NATIVE, target UNSPECIFIED ==
// LOCAL), so a no-op "change" to the default is allowed.
//
// Why this is Class B: the sentinel only matters in the context of execution
// lifecycle, and it is explicitly deferred from the Class A Session suite.
//
// Sentinel seeding: harness_state_id is runner-owned status, written only
// through the session's bindHarnessState door by the runner acting for a
// live run. The suite seeds it exactly that way: a turn held at the mock
// model keeps the run live, the run's credential is minted by the exchange,
// the door records the sentinel, and the turn is cancelled before the arms'
// writes. Each arm reads the sentinel back first, so its assertions rest on
// a genuinely set sentinel.
//
// Asserted contract:
// - harness is freely mutable while the session has no run and no state id;
//   execution_target while harness_state_id is empty.
// - once a native turn has completed, with no state id bound, changing harness
//   -> FAILED_PRECONDITION.
// - once harness_state_id is set, changing harness -> FAILED_PRECONDITION, and
//   changing execution_target -> FAILED_PRECONDITION.
// - a no-op apply to the same (or default-equivalent) value is accepted.
import { Code } from "@connectrpc/connect";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { ExecutionTarget, Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText } from "@stigmer/test-support/mock-llm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { type AgentRefInit, agentRefOf, makeAgent } from "../support/agents";
import { uniqueName } from "../support/naming";
import { awaitPhase, awaitTerminal, makeAgentExecution, requireLlmProxy } from "../support/runs";
import { makeSession } from "../support/sessions";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

const SEED_STATE = "thread-conformance-seed";

/** How long the seeding turn stays IN_PROGRESS unless cancelled. */
const HOLD_MS = 120_000;

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
});

afterEach(async () => {
  mock.releaseHolds();
  // A cancelled run that never reached the model would leave its scripted
  // turn for the next arm; wait, bounded, for every scripted turn to be claimed.
  const claimDeadline = Date.now() + 15_000;
  while (mock.remaining() > 0 && Date.now() < claimDeadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

// Provision an Agent and return the reference a session names it by.
async function provisionAgentRef(org: string): Promise<AgentRefInit> {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent-imm") }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return agentRefOf(agent);
}

/**
 * Sets the sentinel as the runner does (the module header): a held turn on
 * the session, the run's credential, bindHarnessState, then the turn
 * interrupted. Answers the session as read back, its sentinel set.
 */
async function seedSentinel(org: string, sessionId: string): Promise<void> {
  mock.enqueue(anthropicText("Held while the runner binds."), { delayMs: HOLD_MS });
  const run = await clients.agentExecutionCommand.create(
    makeAgentExecution({ org, name: uniqueName("imm-run"), sessionId, message: "seed the sentinel" }),
  );
  const runId = run.metadata!.id;
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: runId }).catch(() => undefined));
  await awaitPhase(clients, runId, RunPhase.RUN_IN_PROGRESS);
  const minted = await clients.platformQuery.getRunnerScopedToken({ scope: { case: "runId", value: runId } });
  const runner = target.clientsPresenting(minted.runnerScopedToken);
  await runner.sessionCommand.bindHarnessState({ runId, harnessStateId: SEED_STATE });
  await clients.sessionCommand.interrupt({ sessionId });
  await awaitTerminal(clients, runId);
  mock.releaseHolds();
  const seeded = await clients.sessionQuery.get({ value: sessionId });
  expect(seeded.status?.harnessStateId, "harness_state_id must persist for this test to be meaningful").toBe(
    SEED_STATE,
  );
}

describe("[rpc:SessionCommandController.apply] Session immutability — harness", () => {
  it("is freely mutable while the session has not run", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionAgentRef(org);
    const name = uniqueName("session-imm");

    // No harness_state_id: harness changes are unrestricted.
    const created = await clients.sessionCommand.apply(
      makeSession({ org, name, agentRef, harness: Harness.NATIVE }),
    );
    fixtures.defer(() => clients.sessionCommand.delete({ value: created.metadata!.id }));

    const toCursor = await clients.sessionCommand.apply(
      makeSession({ org, name, agentRef, harness: Harness.CURSOR }),
    );
    expect(toCursor.spec?.harness, "harness change is allowed before the first run").toBe(Harness.CURSOR);

    const backToNative = await clients.sessionCommand.apply(
      makeSession({ org, name, agentRef, harness: Harness.NATIVE }),
    );
    expect(backToNative.spec?.harness).toBe(Harness.NATIVE);
  });

  it("is immutable once a native turn has run, with no state id bound", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionAgentRef(org);
    const name = uniqueName("session-imm");

    const session = await clients.sessionCommand.apply(makeSession({ org, name, agentRef, harness: Harness.NATIVE }));
    const sessionId = session.metadata!.id;
    fixtures.defer(() => clients.sessionCommand.delete({ value: sessionId }));

    mock.enqueue(anthropicText("Answered on native."));
    const run = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("imm-run"), sessionId, message: "run once" }),
    );
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: run.metadata!.id }).catch(() => undefined));
    const done = await awaitTerminal(clients, run.metadata!.id);
    expect(done.status?.phase, "the native turn must complete for this test to be meaningful").toBe(
      RunPhase.RUN_COMPLETED,
    );
    const ran = await clients.sessionQuery.get({ value: sessionId });
    expect(ran.status?.harnessStateId ?? "", "native binds no state id").toBe("");

    await expectGrpcCode(
      () => clients.sessionCommand.apply(makeSession({ org, name, agentRef, harness: Harness.CURSOR })),
      Code.FailedPrecondition,
      "change harness after a native turn has run",
    );

    const sameHarness = await clients.sessionCommand.apply(
      makeSession({ org, name, agentRef, harness: Harness.NATIVE }),
    );
    expect(sameHarness.spec?.harness).toBe(Harness.NATIVE);
  });

  it("is immutable once harness_state_id is set", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionAgentRef(org);
    const name = uniqueName("session-imm");

    const seeded = await clients.sessionCommand.apply(makeSession({ org, name, agentRef, harness: Harness.NATIVE }));
    fixtures.defer(() => clients.sessionCommand.delete({ value: seeded.metadata!.id }));
    await seedSentinel(org, seeded.metadata!.id);

    // Changing harness is now rejected.
    await expectGrpcCode(
      () =>
        clients.sessionCommand.apply(
          makeSession({ org, name, agentRef, harness: Harness.CURSOR }),
        ),
      Code.FailedPrecondition,
      "change harness after the sentinel is set",
    );

    // Re-applying the same harness is a no-op change and is accepted.
    const sameHarness = await clients.sessionCommand.apply(
      makeSession({ org, name, agentRef, harness: Harness.NATIVE }),
    );
    expect(sameHarness.spec?.harness).toBe(Harness.NATIVE);
  });

  it("treats UNSPECIFIED harness as NATIVE for the immutability comparison", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionAgentRef(org);
    const name = uniqueName("session-imm");

    // Seed with UNSPECIFIED harness (the server normalizes it to NATIVE only at
    // dispatch, not at rest) plus the sentinel.
    const seeded = await clients.sessionCommand.apply(makeSession({ org, name, agentRef }));
    fixtures.defer(() => clients.sessionCommand.delete({ value: seeded.metadata!.id }));
    expect(seeded.spec?.harness).toBe(Harness.UNSPECIFIED);
    await seedSentinel(org, seeded.metadata!.id);

    // Applying explicit NATIVE is the same logical value (UNSPECIFIED == NATIVE):
    // accepted.
    const toNative = await clients.sessionCommand.apply(
      makeSession({ org, name, agentRef, harness: Harness.NATIVE }),
    );
    expect(toNative.spec?.harness).toBe(Harness.NATIVE);

    // Applying CURSOR is a real change from the NATIVE default: rejected.
    await expectGrpcCode(
      () =>
        clients.sessionCommand.apply(
          makeSession({ org, name, agentRef, harness: Harness.CURSOR }),
        ),
      Code.FailedPrecondition,
      "change UNSPECIFIED(==NATIVE) harness to CURSOR after the sentinel is set",
    );
  });
});

describe("[rpc:SessionCommandController.apply] Session immutability — execution_target", () => {
  it("is freely mutable while the harness_state_id sentinel is empty", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionAgentRef(org);
    const name = uniqueName("session-imm");

    const created = await clients.sessionCommand.apply(
      makeSession({ org, name, agentRef, executionTarget: ExecutionTarget.LOCAL }),
    );
    fixtures.defer(() => clients.sessionCommand.delete({ value: created.metadata!.id }));

    const toCloud = await clients.sessionCommand.apply(
      makeSession({ org, name, agentRef, executionTarget: ExecutionTarget.CLOUD }),
    );
    expect(toCloud.spec?.executionTarget, "execution_target change is allowed before the sentinel is set").toBe(
      ExecutionTarget.CLOUD,
    );
  });

  it("is immutable once harness_state_id is set", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionAgentRef(org);
    const name = uniqueName("session-imm");

    const seeded = await clients.sessionCommand.apply(
      makeSession({ org, name, agentRef, executionTarget: ExecutionTarget.LOCAL }),
    );
    fixtures.defer(() => clients.sessionCommand.delete({ value: seeded.metadata!.id }));
    expect(seeded.spec?.executionTarget).toBe(ExecutionTarget.LOCAL);
    await seedSentinel(org, seeded.metadata!.id);

    // Changing execution_target is now rejected.
    await expectGrpcCode(
      () =>
        clients.sessionCommand.apply(
          makeSession({
            org,
            name,
            agentRef,
            executionTarget: ExecutionTarget.CLOUD,
          }),
        ),
      Code.FailedPrecondition,
      "change execution_target after the sentinel is set",
    );

    // Re-applying the same target is a no-op change and is accepted.
    const sameTarget = await clients.sessionCommand.apply(
      makeSession({
        org,
        name,
        agentRef,
        executionTarget: ExecutionTarget.LOCAL,
      }),
    );
    expect(sameTarget.spec?.executionTarget).toBe(ExecutionTarget.LOCAL);
  });
});
