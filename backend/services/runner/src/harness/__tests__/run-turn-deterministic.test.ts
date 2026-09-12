/**
 * The turn runtime under a DETERMINISTIC state id, proven without any engine:
 * the scripted fake adapter declaring `stateIdSource: "deterministic"` (the
 * native harness's posture — `thread-{sessionId}` exists before any engine
 * does) through the kit's runtime-side half under `MockActivityEnvironment`.
 *
 * `run-turn.test.ts` runs the same half under `engine-minted`; this file is
 * the other arm of `isReinvocation` (`turn-context.ts`): here the thread id
 * is present on the FIRST turn, so the runtime's reinvocation fact — the
 * seed, the reconcile, the exact-apply — must come from the persisted
 * transcript and from nothing else. Every kit arm that resumes (the approval
 * round trip) therefore exercises that arm end to end, and the bind arm is
 * reported SKIPPED (a deterministic harness never binds).
 *
 * What is asserted HERE beside the kit are the deterministic FACTS the
 * engine-minted file cannot show: no session write ever happens (there is
 * no id to bind), and a first turn with a thread id already present is
 * still a first turn (nothing seeded, no decision read).
 *
 * Its own file, not a second block in `run-turn.test.ts`: the hermetic
 * environment is created at module level because the subject's `config` is
 * read at collection time, and the forks pool keeps each file's environment
 * private.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

vi.mock("../../client/stigmer-client.js", async () =>
  (await import("../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment } from "../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../__test-utils__/model-registry-fixture.js";
import { scriptedSubject } from "../../__test-utils__/harness-contract/scripted-adapter.js";
import {
  assertApprovalRoundTrip,
  assertCompletedTurn,
  describeHarnessRuntimeContract,
  type RuntimeContractHarness,
} from "../../__test-utils__/harness-contract/runtime-contract.js";

const TASK_QUEUE = "runtime-deterministic-test-queue";

const env = createHermeticEnvironment();
const clock = new ScriptedClock();
const subject = scriptedSubject({
  pausePrimitive: "interrupt",
  stateIdSource: "deterministic",
  config: { workspaceRootDir: env.workspaceRootDir, taskQueue: TASK_QUEUE },
});
const harness: RuntimeContractHarness = { subject, env, clock };

describe("run-turn: the deterministic fake adapter through the real runtime", () => {
  let registry: ReturnType<typeof stubRegistryFetch>;

  beforeAll(() => {
    registry = stubRegistryFetch();
    clock.install();
  });

  afterAll(() => {
    clock.uninstall();
    registry.restore();
    env.dispose();
  });

  describeHarnessRuntimeContract(harness);

  describe("the deterministic facts", () => {
    beforeAll(async () => {
      await subject.adapter.boot(subject.config);
    });

    it("a first turn with the thread id already present is a first turn: nothing seeded, no session write", async () => {
      clock.reset();
      const { driver, final } = await assertCompletedTurn(harness, "det-completed");
      expect(driver.record.persistedPhases).toEqual([ExecutionPhase.EXECUTION_IN_PROGRESS, ExecutionPhase.EXECUTION_COMPLETED]);
      expect(driver.record.sessionUpdates, "a deterministic harness never binds a state id").toHaveLength(0);
      expect(final.messages.length, "the transcript is this turn's alone").toBeGreaterThan(0);
    });

    it("the approval round trip resumes on the transcript, not the thread id: the WAITING row is carried and settled, and no session write happens", async () => {
      clock.reset();
      const { driver } = await assertApprovalRoundTrip(harness, "det-approval");
      expect(driver.record.persistedPhases).toEqual([
        ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
        ExecutionPhase.EXECUTION_IN_PROGRESS,
        ExecutionPhase.EXECUTION_COMPLETED,
      ]);
      expect(driver.record.sessionUpdates).toHaveLength(0);
    });
  });
});
