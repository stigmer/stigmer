/**
 * The turn runtime, proven without any engine: the scripted fake adapter
 * (`__test-utils__/harness-contract/scripted-adapter.ts`) through the kit's
 * runtime-side half (`__test-utils__/harness-contract/runtime-contract.ts`)
 * under `MockActivityEnvironment`, one arm per row of the terminal table.
 *
 * The runtime-side contract itself — the throw-vs-return rule end to end, the
 * single persist chokepoint, the whole-activity heartbeat, the stop
 * controller's four producers, the reinvocation seam, the byte-pinned copy —
 * is the kit's and is registered here through `describeHarnessRuntimeContract`
 * exactly as `activities/execute-cursor/__tests__/hermetic/harness-contract.test.ts`
 * registers it against the real Cursor adapter. An arm that differs between
 * the fake and the real engine is an adapter defect, not a runtime one.
 *
 * What is asserted HERE and not in the kit are the FAKE's facts: the engine
 * cadence a real engine has no reason to share. The fake's `say` awaits its
 * persist and its `propose` persists nothing before returning
 * `awaiting_approval`, so under the runtime its first full write IS the
 * WAITING write (`persistedPhases === [WAITING_FOR_APPROVAL]`) where a
 * streaming engine's IN_PROGRESS writes precede it; the fake has no setup
 * labels of its own, so the runtime's six are the whole list; the fake states
 * its own price, so the cost copy reads exactly `~$0.6000`; and the fake's
 * failure messages reach the status verbatim, where a real engine's
 * classifier rephrases them.
 *
 * The hermetic environment is created at module level because the subject's
 * `config` is read at collection time; the forks pool keeps it private to
 * this file.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ApprovalAction, ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

vi.mock("../../client/stigmer-client.js", async () =>
  (await import("../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment } from "../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../__test-utils__/model-registry-fixture.js";
import { scriptedSubject } from "../../__test-utils__/harness-contract/scripted-adapter.js";
import {
  COST_CAP_FAKE_PRICE_USD,
  FAILURE_MESSAGES,
  RUNTIME_SETUP_LABELS,
  aiMessages,
  assertApprovalRoundTrip,
  assertCompletedTurn,
  assertCostCapTerminates,
  assertFailedSurfaceWritesItsCopy,
  assertNonExecutingDecisionSettlesSkipped,
  assertRejectedBindFails,
  describeHarnessRuntimeContract,
  systemMessages,
  type RuntimeContractHarness,
} from "../../__test-utils__/harness-contract/runtime-contract.js";
import { TERMINAL_COPY } from "../terminal-table.js";

const TASK_QUEUE = "runtime-test-queue";

const env = createHermeticEnvironment();
const clock = new ScriptedClock();
const subject = scriptedSubject({
  pausePrimitive: "interrupt",
  stateIdSource: "engine-minted",
  config: { workspaceRootDir: env.workspaceRootDir, taskQueue: TASK_QUEUE },
});
const harness: RuntimeContractHarness = { subject, env, clock };

describe("run-turn: the fake adapter through the real runtime", () => {
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

  describe("the fake's own facts", () => {
    beforeAll(async () => {
      await subject.adapter.boot(subject.config);
    });

    it("a completed turn: the runtime's six labels are the whole list, the phases, the stated price and its basis", async () => {
      clock.reset();
      const { driver, final } = await assertCompletedTurn(harness, "fake-completed");
      expect(driver.record.persistedPhases).toEqual([ExecutionPhase.EXECUTION_IN_PROGRESS, ExecutionPhase.EXECUTION_COMPLETED]);
      expect(driver.record.setupProgress).toEqual([...RUNTIME_SETUP_LABELS]);
      expect(final.streamingUsage?.estimatedCostUsd, "the summary is the adapter's stated price, summed").toBeCloseTo(0.00136, 9);
      expect(final.streamingUsage?.model, "the basis the adapter named").toBe("fixture-model");
      expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
    });

    it("the approval round trip: the WAITING write is the fake's first full persist (M3a finding 3)", async () => {
      clock.reset();
      const { driver } = await assertApprovalRoundTrip(harness, "fake-approval");
      expect(driver.record.persistedPhases).toEqual([
        ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
        ExecutionPhase.EXECUTION_IN_PROGRESS,
        ExecutionPhase.EXECUTION_COMPLETED,
      ]);
      expect(driver.record.sessionUpdates, "an engine-minted adapter binds once across the round trip").toHaveLength(1);
    });

    it("the cost cap: the fake's stated price reads exactly in the copy", async () => {
      clock.reset();
      const { final } = await assertCostCapTerminates(harness, "fake-cost-cap");
      expect(final.error).toBe(`Agent reached the cost limit for this message (~$${COST_CAP_FAKE_PRICE_USD.toFixed(4)} of the $0.50 budget). Send another message to continue.`);
      expect(final.streamingUsage?.estimatedCostUsd).toBe(COST_CAP_FAKE_PRICE_USD);
    });

    it.each([
      ["engine", []],
      ["actionable", [`Execution failed: ${FAILURE_MESSAGES.actionable}`]],
      ["internal", [TERMINAL_COPY.internalFailure.row, `Error details: ${FAILURE_MESSAGES.internal}`]],
    ] as const)("a %s failure: the fake's message reaches the status verbatim, with that surface's rows", async (surface, rows) => {
      clock.reset();
      const { driver, final } = await assertFailedSurfaceWritesItsCopy(harness, surface, FAILURE_MESSAGES[surface], `fake-failed-${surface}`);
      expect(driver.record.persistedPhases).toEqual([ExecutionPhase.EXECUTION_IN_PROGRESS, ExecutionPhase.EXECUTION_FAILED]);
      expect(final.error).toBe(FAILURE_MESSAGES[surface]);
      expect(systemMessages(final)).toEqual(rows);
    });

    it("a rejected bind: the fake names the failure and nothing of the scenario was folded in", async () => {
      clock.reset();
      const { final } = await assertRejectedBindFails(harness, "fake-bind-rejects");
      expect(final.error).toContain("could not bind engine state");
      expect(aiMessages(final)).toEqual([]);
    });

    it("REJECT continues the run without the tool and the row settles SKIPPED with its reason (stigmer#197; S3 M1, Q-S3-2)", async () => {
      // Until S3 M1 this arm pinned the opposite: the runtime FAILED a
      // reinvocation carrying any REJECT (`rejectedByUserArm`, Cursor's
      // legacy), against the proto's `APPROVAL_ACTION_REJECT` doc, the
      // conformance suite and the native harness (S2 M4 finding F1, Q-M4-1).
      // The kit's runtime half now carries the contract for every subject;
      // what is the fake's own here is the persist cadence around it.
      clock.reset();
      const { driver, final } = await assertNonExecutingDecisionSettlesSkipped(harness, ApprovalAction.REJECT, "fake-reject");
      expect(driver.record.persistedPhases).toEqual([
        ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
        ExecutionPhase.EXECUTION_IN_PROGRESS,
        ExecutionPhase.EXECUTION_COMPLETED,
      ]);
      expect(aiMessages(final)).toContain("Moving on.");
      expect(systemMessages(final), "no terminal copy: the run ended normally").toEqual([]);
    });
  });
});
