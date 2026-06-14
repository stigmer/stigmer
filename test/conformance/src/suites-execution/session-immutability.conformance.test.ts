// Conformance suite for Session immutability sentinels (Class B).
// Domain: agentic / session — the harness and execution_target immutability
// validators gated by spec.harness_state_id.
//
// A Session's harness (NATIVE vs CURSOR) and execution_target (LOCAL vs CLOUD)
// each own conversation/workspace state that is not portable once a run has
// started. The server enforces this with two update-time validators
// (validate_harness_immutability.go, validate_execution_target_immutability.go):
// once spec.harness_state_id is non-empty, changing harness or execution_target is
// rejected with FAILED_PRECONDITION. Both validators treat the UNSPECIFIED enum as
// its default (harness UNSPECIFIED == NATIVE, target UNSPECIFIED == LOCAL), so a
// no-op "change" to the default is allowed.
//
// Why this is Class B: the sentinel only matters in the context of execution
// lifecycle, and it is explicitly deferred from the Class A Session suite. It is
// placed here with the execution-domain suites for that reason.
//
// Sentinel seeding — important design note: harness_state_id is documented to be
// engine-populated after the first execution. In this conformance environment that
// path is not reachable: only the CURSOR harness persists harness_state_id (it
// stores the Cursor agentId), and the suite has no Cursor backend; the NATIVE
// deep-agent path's EnsureThread computes a thread id but does NOT persist it to
// the session (a known gap between the proto's documented intent and the runner
// implementation, recorded in the Session-13 checkpoint / DD-013). So instead of
// driving an execution, the suite sets harness_state_id directly — it is a plain,
// client-settable spec field with no output-only annotation, so writing it through
// create/apply is within the public contract and exercises the validators exactly
// as a post-execution session would. The first test below verifies the seed
// actually round-trips, so the immutability assertions rest on a confirmed sentinel.
//
// Asserted contract:
// - harness/execution_target are freely mutable while harness_state_id is empty.
// - once harness_state_id is set, changing harness -> FAILED_PRECONDITION, and
//   changing execution_target -> FAILED_PRECONDITION.
// - a no-op apply to the same (or default-equivalent) value is accepted.
import { Code } from "@connectrpc/connect";
import { ExecutionTarget, Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
import { uniqueName } from "../support/naming";
import { makeSession } from "../support/sessions";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();

const SEED_STATE = "thread-conformance-seed";

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

// Provision an Agent and return its default instance id (Session's required ref).
async function provisionAgentInstance(org: string): Promise<string> {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent-imm") }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  const agentInstanceId = agent.status?.defaultInstanceId;
  if (agentInstanceId === undefined || agentInstanceId === "") {
    throw new Error("agent create did not provision a default instance id");
  }
  return agentInstanceId;
}

describe("Session immutability — harness", () => {
  it("is freely mutable while the harness_state_id sentinel is empty", async () => {
    const { org } = await target.provisionTenancy();
    const agentInstanceId = await provisionAgentInstance(org);
    const name = uniqueName("session-imm");

    // No harness_state_id: harness changes are unrestricted.
    const created = await clients.sessionCommand.apply(
      makeSession({ org, name, agentInstanceId, harness: Harness.NATIVE }),
    );
    fixtures.defer(() => clients.sessionCommand.delete({ value: created.metadata!.id }));

    const toCursor = await clients.sessionCommand.apply(
      makeSession({ org, name, agentInstanceId, harness: Harness.CURSOR }),
    );
    expect(toCursor.spec?.harness, "harness change is allowed before the sentinel is set").toBe(Harness.CURSOR);

    const backToNative = await clients.sessionCommand.apply(
      makeSession({ org, name, agentInstanceId, harness: Harness.NATIVE }),
    );
    expect(backToNative.spec?.harness).toBe(Harness.NATIVE);
  });

  it("is immutable once harness_state_id is set", async () => {
    const { org } = await target.provisionTenancy();
    const agentInstanceId = await provisionAgentInstance(org);
    const name = uniqueName("session-imm");

    // Seed the sentinel directly and confirm it round-trips, so the immutability
    // assertions below rest on a genuinely-set sentinel.
    const seeded = await clients.sessionCommand.apply(
      makeSession({ org, name, agentInstanceId, harness: Harness.NATIVE, harnessStateId: SEED_STATE }),
    );
    fixtures.defer(() => clients.sessionCommand.delete({ value: seeded.metadata!.id }));
    expect(seeded.spec?.harnessStateId, "harness_state_id must persist for this test to be meaningful").toBe(
      SEED_STATE,
    );

    // Changing harness is now rejected.
    await expectGrpcCode(
      () =>
        clients.sessionCommand.apply(
          makeSession({ org, name, agentInstanceId, harness: Harness.CURSOR, harnessStateId: SEED_STATE }),
        ),
      Code.FailedPrecondition,
      "change harness after the sentinel is set",
    );

    // Re-applying the same harness is a no-op change and is accepted.
    const sameHarness = await clients.sessionCommand.apply(
      makeSession({ org, name, agentInstanceId, harness: Harness.NATIVE, harnessStateId: SEED_STATE }),
    );
    expect(sameHarness.spec?.harness).toBe(Harness.NATIVE);
  });

  it("treats UNSPECIFIED harness as NATIVE for the immutability comparison", async () => {
    const { org } = await target.provisionTenancy();
    const agentInstanceId = await provisionAgentInstance(org);
    const name = uniqueName("session-imm");

    // Seed with UNSPECIFIED harness (the server normalizes it to NATIVE only at
    // dispatch, not at rest) plus the sentinel.
    const seeded = await clients.sessionCommand.apply(
      makeSession({ org, name, agentInstanceId, harnessStateId: SEED_STATE }),
    );
    fixtures.defer(() => clients.sessionCommand.delete({ value: seeded.metadata!.id }));
    expect(seeded.spec?.harness).toBe(Harness.UNSPECIFIED);

    // Applying explicit NATIVE is the same logical value (UNSPECIFIED == NATIVE):
    // accepted.
    const toNative = await clients.sessionCommand.apply(
      makeSession({ org, name, agentInstanceId, harness: Harness.NATIVE, harnessStateId: SEED_STATE }),
    );
    expect(toNative.spec?.harness).toBe(Harness.NATIVE);

    // Applying CURSOR is a real change from the NATIVE default: rejected.
    await expectGrpcCode(
      () =>
        clients.sessionCommand.apply(
          makeSession({ org, name, agentInstanceId, harness: Harness.CURSOR, harnessStateId: SEED_STATE }),
        ),
      Code.FailedPrecondition,
      "change UNSPECIFIED(==NATIVE) harness to CURSOR after the sentinel is set",
    );
  });
});

describe("Session immutability — execution_target", () => {
  it("is freely mutable while the harness_state_id sentinel is empty", async () => {
    const { org } = await target.provisionTenancy();
    const agentInstanceId = await provisionAgentInstance(org);
    const name = uniqueName("session-imm");

    const created = await clients.sessionCommand.apply(
      makeSession({ org, name, agentInstanceId, executionTarget: ExecutionTarget.LOCAL }),
    );
    fixtures.defer(() => clients.sessionCommand.delete({ value: created.metadata!.id }));

    const toCloud = await clients.sessionCommand.apply(
      makeSession({ org, name, agentInstanceId, executionTarget: ExecutionTarget.CLOUD }),
    );
    expect(toCloud.spec?.executionTarget, "execution_target change is allowed before the sentinel is set").toBe(
      ExecutionTarget.CLOUD,
    );
  });

  it("is immutable once harness_state_id is set", async () => {
    const { org } = await target.provisionTenancy();
    const agentInstanceId = await provisionAgentInstance(org);
    const name = uniqueName("session-imm");

    const seeded = await clients.sessionCommand.apply(
      makeSession({
        org,
        name,
        agentInstanceId,
        executionTarget: ExecutionTarget.LOCAL,
        harnessStateId: SEED_STATE,
      }),
    );
    fixtures.defer(() => clients.sessionCommand.delete({ value: seeded.metadata!.id }));
    expect(seeded.spec?.executionTarget).toBe(ExecutionTarget.LOCAL);
    expect(seeded.spec?.harnessStateId).toBe(SEED_STATE);

    // Changing execution_target is now rejected.
    await expectGrpcCode(
      () =>
        clients.sessionCommand.apply(
          makeSession({
            org,
            name,
            agentInstanceId,
            executionTarget: ExecutionTarget.CLOUD,
            harnessStateId: SEED_STATE,
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
        agentInstanceId,
        executionTarget: ExecutionTarget.LOCAL,
        harnessStateId: SEED_STATE,
      }),
    );
    expect(sameTarget.spec?.executionTarget).toBe(ExecutionTarget.LOCAL);
  });
});
