/**
 * The harness contract kit, BOTH halves, against the REAL Cursor adapter.
 *
 * The adapter-side half (`__test-utils__/harness-contract/contract.ts`) is the
 * single statement of what every `HarnessAdapter` owes the runtime;
 * `src/__tests__/harness-contract.test.ts` runs it against the scripted fake
 * under both pause primitives. The runtime-side half
 * (`__test-utils__/harness-contract/runtime-contract.ts`) is what the turn
 * runtime owes every harness, through the real activity under
 * `MockActivityEnvironment`; `harness/__tests__/run-turn.test.ts` runs it
 * against the fake. This file runs BOTH against `createCursorAdapter()`
 * through the Cursor subject (`__test-utils__/contract-subject.ts`), which
 * translates the kit's scenarios onto S0's scripted `@cursor/sdk` double and
 * runs the REAL bash preToolUse hook the adapter installs for every gated
 * proposal. Nothing of the adapter is mocked; the SDK and the control-plane
 * client are the two doubles every hermetic golden already substitutes.
 *
 * Every runtime arm here has a golden twin under `goldens/`; the goldens pin
 * the transcript byte for byte, the kit asserts the contract facts in words
 * any harness can satisfy. The `actionable` failure arm is registered
 * SKIPPED: only the unattributed-hook-block path produces that surface on
 * this harness (`unattributed-hook-block.test.ts` pins it), and the kit's
 * vocabulary has no word for it.
 *
 * Beside the kit, the Cursor-only observations the kit's vocabulary cannot
 * express: the agent the SDK minted is CLOSED when the session write behind
 * `bindHarnessState` rejects (S2 M4 finding F5, an M3b regression the kit's
 * rejected-bind leg exposed — before the fix the handle leaked its executor
 * lease and MCP subprocesses; Q-M4-8); the SDK is asked to create one agent
 * per session and never to resume (the parked handle serves every later
 * turn, #215); a DISOBEDIENT re-issue after a SKIP is denied by the hook and
 * never executes (what makes the subject's "obedient model" modelling safe);
 * a later proposal of an identity the user already approved and the agent
 * already ran gets its OWN gate and inherits nothing — the approval bleed the
 * kit's invariant 3 found in this adapter (S2 M4 finding F9;
 * `same-identity-reproposal.test.ts` pins the translator's rule); and the
 * hook agreed with the subject's model of it at every proposal.
 *
 * Needs `bash` (the hook) — skipped where it is unavailable, reported as
 * SKIPPED, never a silent pass. The hermetic environment (temp `HOME` for the
 * gate's per-session artifacts, temp workspace root) is created at module
 * level because the subject's `config` is read at collection time; the forks
 * pool keeps it private to this file. No golden: the kit asserts behaviour,
 * the goldens under `goldens/` pin transcripts.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ApprovalAction, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

vi.mock("@cursor/sdk", async () =>
  (await import("../../__test-utils__/scripted-sdk.js")).scriptedCursorSdkModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { approvalDecisionsOf } from "../../../../harness/approval-decisions.js";
import { ExecutionDriver, describeHarnessContract } from "../../../../__test-utils__/harness-contract/contract.js";
import { RecordingTurnSink } from "../../../../__test-utils__/harness-contract/recording-sink.js";
import { describeHarnessRuntimeContract } from "../../../../__test-utils__/harness-contract/runtime-contract.js";
import { scenario } from "../../../../__test-utils__/harness-contract/types.js";
import { ScriptedClock, createHermeticEnvironment } from "../../../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { findToolCallRow } from "../../../../__test-utils__/proto-helpers.js";
import { createCursorContractSubject } from "../../__test-utils__/contract-subject.js";
import { hasBash } from "../../__test-utils__/cursor-hook-harness.js";
import { resetCursorModuleState } from "../../__test-utils__/hermetic-cursor.js";

const env = createHermeticEnvironment();
const clock = new ScriptedClock();
const subject = createCursorContractSubject(env);
const WRITE_GAMMA = { kind: "write", resource: "/work/gamma.txt" } as const;

describe.skipIf(!hasBash)("ExecuteCursor hermetic — the harness contract kit against the real adapter", () => {
  let registry: ReturnType<typeof stubRegistryFetch>;

  beforeAll(() => {
    // Once, never between turns: a parked agent must survive turn 1 into
    // turn 2 as it does in a live worker.
    resetCursorModuleState();
    registry = stubRegistryFetch();
    clock.install();
  });

  afterAll(() => {
    clock.uninstall();
    registry.restore();
    env.dispose();
  });

  describeHarnessContract(subject);
  describeHarnessRuntimeContract({ subject, env, clock }, { failureSurfaces: ["engine", "internal"], toolCallLimit: false });

  describe("cursor-only observations", () => {
    beforeAll(async () => {
      await subject.adapter.boot(subject.config);
    });

    it("closes the agent the SDK minted when the session write behind bindHarnessState rejects (F5)", async () => {
      const driver = new ExecutionDriver(subject, "obs-bind-rejects");
      const rejecting = new RecordingTurnSink({ bindRejectsWith: new Error("session write refused") });

      const { outcome } = await driver.turn([scenario.say("never sent")], { sink: rejecting });

      expect(outcome.kind).toBe("failed");
      const agent = subject.agentFor(driver.sessionId);
      expect(agent, "the SDK minted an agent for the session").toBeDefined();
      expect(agent!.sends, "nothing was sent to it").toHaveLength(0);
      expect(agent!.closeCalls, "and it was closed, not leaked: its id was never saved, so no later turn can resume it").toBe(1);
    });

    it("asks the SDK to create one agent per session and never to resume it (#215: the parked handle serves every later turn)", async () => {
      const driver = new ExecutionDriver(subject, "obs-one-create");

      const first = await driver.turn([scenario.say("first")]);
      const second = await driver.turn([scenario.say("second")]);

      expect(first.outcome.kind).toBe("completed");
      expect(second.outcome.kind).toBe("completed");
      const agent = subject.agentFor(driver.sessionId)!;
      const resolutions = subject.sdk.resolutions.filter((r) => r.agentId === agent.agentId);
      expect(resolutions.map((r) => r.kind), "one create, no resume").toEqual(["create"]);
      expect(agent.sends, "both turns went to the same parked agent").toHaveLength(2);
    });

    it("denies a disobedient re-issue after a SKIP: the action never executes and the turn re-gates", async () => {
      const driver = new ExecutionDriver(subject, "obs-disobedient");
      const id = "obs-disobedient-write";

      const proposed = await driver.turn([scenario.propose(id, WRITE_GAMMA)]);
      expect(proposed.outcome.kind).toBe("awaiting_approval");
      driver.decide(id, ApprovalAction.SKIP);

      subject.forceReissue(id);
      const reissued = await driver.turn([scenario.propose(id, WRITE_GAMMA), scenario.say("never reached")]);

      expect(subject.executionCount(id), "the hook denied the re-issue; nothing ran").toBe(0);
      expect(reissued.outcome.kind, "a fresh gated act pauses the turn again").toBe("awaiting_approval");
    });

    it("gates a later proposal of an already-approved-and-run identity on its own row; the executed row and its decision stand (F9)", async () => {
      const driver = new ExecutionDriver(subject, "obs-reproposal");
      const first = "obs-reproposal-first";
      const later = "obs-reproposal-later";

      const proposed = await driver.turn([scenario.propose(first, WRITE_GAMMA)]);
      expect(proposed.outcome.kind).toBe("awaiting_approval");
      driver.decide(first, ApprovalAction.APPROVE);
      const ran = await driver.turn([scenario.propose(first, WRITE_GAMMA), scenario.say("written")]);
      expect(ran.outcome.kind).toBe("completed");
      expect(subject.executionCount(first)).toBe(1);

      const again = await driver.turn([scenario.say("once more"), scenario.propose(later, WRITE_GAMMA)]);

      expect(again.outcome.kind, "a new act of the same identity is gated afresh").toBe("awaiting_approval");
      expect(subject.executionCount(later), "and did not run under the earlier approval").toBe(0);
      const firstRow = findToolCallRow(again.sink.status, first)!;
      expect(firstRow.status, "the executed row is never rewritten").toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
      expect(firstRow.approvalAction).toBe(ApprovalAction.APPROVE);
      const laterRow = findToolCallRow(again.sink.status, later);
      expect(laterRow?.status, "the new act has its own WAITING row").toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
      expect(laterRow?.approvalAction, "undecided").toBe(ApprovalAction.UNSPECIFIED);
      expect(approvalDecisionsOf(again.sink.status).size, "the runtime would read no decision for it").toBe(0);
    });

    it("the hook agreed with the subject's model of it at every proposal", () => {
      expect(subject.hookDisagreements).toEqual([]);
    });
  });
});
