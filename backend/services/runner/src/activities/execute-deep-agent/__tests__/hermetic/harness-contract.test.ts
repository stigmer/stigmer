/**
 * The harness contract kit, BOTH halves, against the REAL native deep-agent
 * adapter under the sqlite checkpointer.
 *
 * The adapter-side half (`__test-utils__/harness-contract/contract.ts`) is the
 * single statement of what every `HarnessAdapter` owes the runtime;
 * `src/__tests__/harness-contract.test.ts` runs it against the scripted fake
 * under both pause primitives, `execute-cursor/__tests__/hermetic/
 * harness-contract.test.ts` against the real Cursor adapter. The runtime-side
 * half (`runtime-contract.ts`) is what the turn runtime owes every harness,
 * through the real activity under `MockActivityEnvironment`. This file runs
 * BOTH against `createDeepAgentAdapter()` through the native subject
 * (`__test-utils__/contract-subject.ts`), which translates the kit's
 * scenarios onto the `ScriptedModel` double and lets deepagents' real
 * built-ins run over the real approval gate. Nothing of the adapter is
 * mocked; the model client and the control-plane client are the two doubles
 * every native hermetic golden already substitutes.
 *
 * The posture is sqlite, the production local default (`config.ts`): the
 * test-only memory saver re-interrupts on replay and duplicates the gated
 * row (S3 M0 finding F-M0-3), so it cannot carry the HITL arms. One sqlite
 * file per session lands under the hermetic `HOME`, opened and closed per
 * turn by the adapter.
 *
 * What this subject declares it cannot produce, so the kit reports the arm
 * SKIPPED and never silently passes: the `engine` and `actionable` failure
 * surfaces (`turn.ts` classifies every escaped error `internal` — the
 * adapter has one surface), and an engine-side cancel (no native path ends a
 * turn `cancelled`).
 *
 * Beside the kit, the native-only observations its vocabulary cannot
 * express — the interrupt primitive's own facts: an APPROVED pending action
 * executes at the resume, before the model is asked (the order the kit's
 * invariant 4 used to assert the other way round, until this adapter showed
 * it is the primitive's and not the contract's — S3 M3 F-M3-1, Q-M3-2); a
 * REJECT reaches the model as the gate's denial `ToolMessage` in the
 * conversation, and the model proposes the call exactly once (the denial is
 * a tool result the model reads, never a second gate); and one sqlite
 * checkpoint per session lands under the hermetic `HOME`, none for a session
 * never served.
 *
 * No golden: the kit asserts behaviour, the goldens under `goldens/` pin
 * transcripts. The hermetic environment is created at module level because
 * the subject's `config` is read at collection time; the forks pool keeps it
 * private to this file.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { isAIMessage, isToolMessage } from "@langchain/core/messages";
import { ApprovalAction, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

vi.mock("../../../../shared/model-client.js", async () =>
  (await import("../../__test-utils__/scripted-model-module.js")).scriptedModelClientModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ExecutionDriver, describeHarnessContract } from "../../../../__test-utils__/harness-contract/contract.js";
import { describeHarnessRuntimeContract } from "../../../../__test-utils__/harness-contract/runtime-contract.js";
import { scenario } from "../../../../__test-utils__/harness-contract/types.js";
import { ScriptedClock, createHermeticEnvironment } from "../../../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { findToolCallRow } from "../../../../__test-utils__/proto-helpers.js";
import { getCheckpointDbPath } from "../../../../shared/workspace/platform-dir.js";
import { createDeepAgentContractSubject } from "../../__test-utils__/contract-subject.js";

const env = createHermeticEnvironment();
const clock = new ScriptedClock();
const subject = createDeepAgentContractSubject(env);
const WRITE_GAMMA = { kind: "write", resource: "/work/gamma.txt" } as const;

describe("ExecuteDeepAgent hermetic — the harness contract kit against the real adapter", () => {
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

  describeHarnessContract(subject);
  describeHarnessRuntimeContract({ subject, env, clock }, { failureSurfaces: ["internal"], engineCancel: false });

  describe("native-only observations", () => {
    beforeAll(async () => {
      await subject.adapter.boot(subject.config);
    });

    it("executes an APPROVED pending action at the resume, before the model is asked — even when the model then hangs and the turn is stopped (interrupt order, F-M3-1)", async () => {
      const driver = new ExecutionDriver(subject, "obs-approved-at-resume");
      const id = "obs-approved-at-resume-write";

      const proposed = await driver.turn([scenario.propose(id, WRITE_GAMMA)]);
      expect(proposed.outcome.kind).toBe("awaiting_approval");
      driver.decide(id, ApprovalAction.APPROVE);

      const hanging = driver.begin([scenario.say("working"), scenario.hang(), scenario.propose(id, WRITE_GAMMA)], { stopWhenHanging: "kit: user pause" });
      const outcome = await hanging.settled;

      expect(outcome.kind).toBe("interrupted");
      expect(subject.executionCount(id), "the resume completed the pending task before the hang; the stop came after").toBe(1);
      expect(findToolCallRow(hanging.sink.status, id)?.status, "and the row on the interrupted turn's status says so").toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    });

    it("hands a REJECT to the model as the gate's denial ToolMessage; the call is proposed exactly once and never re-gated", async () => {
      const driver = new ExecutionDriver(subject, "obs-reject-as-denial");
      const id = "obs-reject-as-denial-write";

      const proposed = await driver.turn([scenario.propose(id, WRITE_GAMMA)]);
      expect(proposed.outcome.kind).toBe("awaiting_approval");
      driver.decide(id, ApprovalAction.REJECT);
      const resumed = await driver.turn([scenario.propose(id, WRITE_GAMMA), scenario.say("moving on")]);
      expect(resumed.outcome.kind).toBe("completed");

      const transcript = subject.lastTranscriptOf(driver.executionId)!;
      const denials = transcript.filter((m) => isToolMessage(m) && m.tool_call_id === id);
      const proposals = transcript.filter((m) => isAIMessage(m) && (m.tool_calls ?? []).some((tc) => tc.id === id));
      expect(denials, "the model read the gate's answer as a tool result").toHaveLength(1);
      expect(proposals, "and had proposed the call exactly once").toHaveLength(1);
      expect(subject.executionCount(id)).toBe(0);
    });

    it("keeps one sqlite checkpoint per session under the hermetic HOME, none for a session never served", async () => {
      const served = new ExecutionDriver(subject, "obs-sqlite-a");
      const other = new ExecutionDriver(subject, "obs-sqlite-b");
      expect((await served.turn([scenario.say("first")])).outcome.kind).toBe("completed");
      expect((await other.turn([scenario.say("second")])).outcome.kind).toBe("completed");

      const [a, b] = [getCheckpointDbPath(served.sessionId), getCheckpointDbPath(other.sessionId)];
      expect(a.startsWith(env.home), "the checkpoint lives under the runner-owned HOME tree").toBe(true);
      expect(a).not.toBe(b);
      expect(existsSync(a)).toBe(true);
      expect(existsSync(b)).toBe(true);
      expect(existsSync(getCheckpointDbPath("ses-never-served")), "a session never served has no checkpoint").toBe(false);
    });
  });
});
