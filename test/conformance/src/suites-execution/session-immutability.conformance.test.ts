// Conformance suite for a Session's immutable fields once it has run (Class B).
// Domain: agentic / session — the harness and execution_target immutability
// validators.
//
// A Session's harness (native vs Claude) and execution_target (local vs
// cloud) each own state that is not portable once a turn has run: the
// harness its conversation, the target the workspace the turn wrote. The
// server enforces this with two update-time validators that judge "this
// session has run" by one fact every harness leaves, a run row in the
// session (stigmer/stigmer#2566, #2598). A change past either lock is
// rejected with FAILED_PRECONDITION. A harness left unset in the update
// keeps the stored one, and a stored UNSPECIFIED compares as NATIVE; an
// unset execution_target resolves to the deployment's default on both
// sides, so a no-op "change" to the default is allowed.
//
// Why this is Class B: "has run" is an execution fact, so each arm drives a
// real turn on the wire mock to completion before its writes.
//
// Asserted contract:
// - harness and execution_target are freely mutable while the session has
//   not run;
// - once a turn has run, on native and on Claude, changing harness ->
//   FAILED_PRECONDITION, and changing execution_target ->
//   FAILED_PRECONDITION, each with its validator's copy; re-applying the
//   same values is accepted;
// - an UNSPECIFIED harness compares as NATIVE: re-applying NATIVE after a
//   turn is accepted, and CLAUDE is refused.
import { Code } from "@connectrpc/connect";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { ExecutionTarget, Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { type AgentRefInit, agentRefOf, makeAgent } from "../support/agents";
import { CLAUDE_ARM, claudeTurnsOnly, type EngineArm, NATIVE_ARM } from "../support/engine-arms";
import { uniqueName } from "../support/naming";
import { awaitTerminal, makeAgentExecution, requireLlmProxy } from "../support/runs";
import { makeSession } from "../support/sessions";
import { createTarget, type TargetProfile } from "../targets";

const collectionTarget = createTarget();

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

/** The harness lock's refusal copy (domain/session/steps.ts). */
const HARNESS_LOCKED = "session harness cannot be changed after the first execution";
/** The execution-target lock's refusal copy, up to the targets it names. */
const TARGET_LOCKED = "session execution_target cannot be changed after the first execution";

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

// Provision an Agent and return the reference a session names it by.
async function provisionAgentRef(org: string): Promise<AgentRefInit> {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent-imm") }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return agentRefOf(agent);
}

/**
 * Runs one turn in the session on `arm`'s engine, to completion: the run
 * row it leaves is what both locks judge "has run" by.
 */
async function runTurn(org: string, sessionId: string, arm: EngineArm): Promise<void> {
  const task = uniqueName("Answer once");
  arm.script(mock, task, [{ kind: "text", text: `Answered on ${arm.word}.` }]);
  const run = await clients.agentExecutionCommand.create(
    makeAgentExecution({ org, name: uniqueName("imm-run"), sessionId, message: task }),
  );
  const runId = run.metadata!.id;
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: runId }).catch(() => undefined));
  const done = await awaitTerminal(clients, runId);
  expect(done.status?.phase, `the ${arm.word} turn must complete for this test to be meaningful: ${done.status?.error}`).toBe(
    RunPhase.RUN_COMPLETED,
  );
}

describe("[rpc:SessionCommandController.apply] Session immutability — before the first turn", () => {
  it("harness is freely mutable while the session has not run", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionAgentRef(org);
    const name = uniqueName("session-imm");

    const created = await clients.sessionCommand.apply(makeSession({ org, name, agentRef, harness: Harness.STIGMER }));
    fixtures.defer(() => clients.sessionCommand.delete({ value: created.metadata!.id }));

    const toClaude = await clients.sessionCommand.apply(makeSession({ org, name, agentRef, harness: Harness.CLAUDE }));
    expect(toClaude.spec?.harness, "harness change is allowed before the first run").toBe(Harness.CLAUDE);

    const backToNative = await clients.sessionCommand.apply(makeSession({ org, name, agentRef, harness: Harness.STIGMER }));
    expect(backToNative.spec?.harness).toBe(Harness.STIGMER);
  });

  it("execution_target is freely mutable while the session has not run", async () => {
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
    expect(toCloud.spec?.executionTarget, "execution_target change is allowed before the first run").toBe(
      ExecutionTarget.CLOUD,
    );
  });
});

/** Each engine a turn runs on, with the harness its session names and the one it would change to. */
const ENGINES: readonly { readonly arm: EngineArm; readonly harness: Harness; readonly other: Harness }[] = [
  { arm: NATIVE_ARM, harness: Harness.STIGMER, other: Harness.CLAUDE },
  { arm: CLAUDE_ARM, harness: Harness.CLAUDE, other: Harness.STIGMER },
];

for (const { arm, harness, other } of ENGINES) {
  describe(`[rpc:SessionCommandController.apply] Session immutability — once a turn has run on ${arm.word}`, () => {
    if (arm.word === "claude") beforeEach(claudeTurnsOnly(collectionTarget.capabilities));

    it("refuses a change of harness and a move between local and cloud; the same values again are accepted", async () => {
      const { org } = await target.provisionTenancy();
      const agentRef = await provisionAgentRef(org);
      const name = uniqueName("session-imm");

      const session = await clients.sessionCommand.apply(
        makeSession({ org, name, agentRef, harness, executionTarget: ExecutionTarget.LOCAL }),
      );
      const sessionId = session.metadata!.id;
      fixtures.defer(() => clients.sessionCommand.delete({ value: sessionId }));
      await runTurn(org, sessionId, arm);

      const harnessChange = await expectGrpcCode(
        () =>
          clients.sessionCommand.apply(
            makeSession({ org, name, agentRef, harness: other, executionTarget: ExecutionTarget.LOCAL }),
          ),
        Code.FailedPrecondition,
        `change harness after a ${arm.word} turn has run`,
      );
      expect(harnessChange.rawMessage).toContain(HARNESS_LOCKED);

      const targetMove = await expectGrpcCode(
        () =>
          clients.sessionCommand.apply(
            makeSession({ org, name, agentRef, harness, executionTarget: ExecutionTarget.CLOUD }),
          ),
        Code.FailedPrecondition,
        `move the session from local to cloud after a ${arm.word} turn has run`,
      );
      expect(targetMove.rawMessage).toContain(TARGET_LOCKED);

      const same = await clients.sessionCommand.apply(
        makeSession({ org, name, agentRef, harness, executionTarget: ExecutionTarget.LOCAL }),
      );
      expect([same.spec?.harness, same.spec?.executionTarget], "the same values are no change").toEqual([
        harness,
        ExecutionTarget.LOCAL,
      ]);
    });
  });
}

describe("[rpc:SessionCommandController.apply] Session immutability — an unset harness", () => {
  it("treats UNSPECIFIED harness as NATIVE for the immutability comparison", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionAgentRef(org);
    const name = uniqueName("session-imm");

    // An unset harness is stored UNSPECIFIED (the server reads it as NATIVE
    // at dispatch, not at rest), and the turn runs on native.
    const session = await clients.sessionCommand.apply(makeSession({ org, name, agentRef }));
    const sessionId = session.metadata!.id;
    fixtures.defer(() => clients.sessionCommand.delete({ value: sessionId }));
    expect(session.spec?.harness).toBe(Harness.UNSPECIFIED);
    await runTurn(org, sessionId, NATIVE_ARM);

    // Explicit NATIVE is the same logical value (UNSPECIFIED == NATIVE): accepted.
    const toNative = await clients.sessionCommand.apply(makeSession({ org, name, agentRef, harness: Harness.STIGMER }));
    expect(toNative.spec?.harness).toBe(Harness.STIGMER);

    // CLAUDE is a real change from the NATIVE default: refused.
    const refused = await expectGrpcCode(
      () => clients.sessionCommand.apply(makeSession({ org, name, agentRef, harness: Harness.CLAUDE })),
      Code.FailedPrecondition,
      "change UNSPECIFIED(==NATIVE) harness to CLAUDE after a turn has run",
    );
    expect(refused.rawMessage).toContain(HARNESS_LOCKED);
  });
});
