/**
 * Hermetic arm: two gated calls proposed in ONE model round, on the durable
 * (sqlite) checkpointer.
 *
 * The native prompt asks the model to make independent calls together
 * (`prompt-builder.ts`, "Working with tools"), so with approvals on, several
 * calls wait in the same round more often than they used to. The resume path
 * was built for it: `hitl.ts` `resolveResumeInput` builds one
 * `Command(resume)` map over every pending interrupt, keyed by interrupt id.
 * Every other approval arm gates one call per round, so this pins that
 * design on the real graph:
 *
 * - the turn pauses once, with BOTH rows waiting and nothing run;
 * - approving both runs each exactly once and completes the turn;
 * - approving one and rejecting the other runs only the approved call,
 *   settles the rejected one without running it, and completes the turn.
 *
 * "Exactly once" is read off the workspace: each command appends a line to
 * its own file, so a replayed call would leave two.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ApprovalAction,
  ExecutionPhase,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

vi.mock("../../../../shared/model-client.js", async () =>
  (await import("../../__test-utils__/scripted-model-module.js")).scriptedModelClientModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import {
  ScriptedClock,
  createHermeticEnvironment,
  type HermeticEnvironment,
} from "../../../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import {
  beginDeepAgentScenario,
  deepAgentExecutionRecord,
  resetDeepAgentScenarioState,
  runDeepAgentTurn,
  sessionWorkspaceDir,
} from "../../__test-utils__/hermetic-deep-agent.js";
import { CLOSING_TURN } from "../../__test-utils__/hitl-script.js";
import type { ScriptedToolCall } from "../../__test-utils__/scripted-model.js";

const USER_MESSAGE = "Run both commands for me.";
const DECIDED_AT = "2026-01-01T00:00:30.000Z";

const CALL_A: ScriptedToolCall = { id: "call-parallel-a", name: "execute", args: { command: "echo ran >> ran-a.log" } };
const CALL_B: ScriptedToolCall = { id: "call-parallel-b", name: "execute", args: { command: "echo ran >> ran-b.log" } };

function linesIn(env: HermeticEnvironment, file: string): number {
  const path = join(sessionWorkspaceDir(env), file);
  return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).length : 0;
}

describe("ExecuteDeepAgent hermetic — two gated calls in one round (sqlite)", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  const clock = new ScriptedClock();

  beforeAll(() => {
    env = createHermeticEnvironment();
    registry = stubRegistryFetch();
    clock.install();
  });

  afterAll(() => {
    clock.uninstall();
    registry.restore();
    env.dispose();
  });

  describe.each([
    { name: "approve both", decideB: ApprovalAction.APPROVE, bRuns: 1, bStatus: ToolCallStatus.TOOL_CALL_COMPLETED },
    { name: "approve one, reject the other", decideB: ApprovalAction.REJECT, bRuns: 0, bStatus: ToolCallStatus.TOOL_CALL_SKIPPED },
  ])("$name", ({ decideB, bRuns, bStatus }) => {
    it("pauses once with both waiting, then runs each approved call exactly once and completes", async () => {
      // ── Arrange ────────────────────────────────────────────────────────────
      clock.reset();
      resetDeepAgentScenarioState(env);
      const record = deepAgentExecutionRecord({ message: USER_MESSAGE });
      const scenario = beginDeepAgentScenario({
        env,
        clock,
        record,
        checkpointer: "sqlite",
        script: () => ({
          turns: [
            { text: "Running both.", toolCalls: [CALL_A, CALL_B], usage: { inputTokens: 1_400, outputTokens: 60 } },
            CLOSING_TURN,
          ],
        }),
      });

      // ── Turn 1: one pause, both rows waiting, nothing run ──────────────────
      const turn1 = await runDeepAgentTurn(scenario, { turnSeq: 0 });
      expect(turn1.outcome.kind).toBe("returned");
      expect((turn1.outcome as { value: Record<string, unknown> }).value.phase).toBe("EXECUTION_WAITING_FOR_APPROVAL");
      expect(record.waitingToolCalls().map((tc) => tc.id).sort()).toEqual([CALL_A.id, CALL_B.id]);
      expect(linesIn(env, "ran-a.log") + linesIn(env, "ran-b.log"), "nothing runs before a decision").toBe(0);

      // ── Between turns: each call decided on its own ────────────────────────
      expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE, DECIDED_AT, CALL_A.id)).toBe(1);
      expect(record.decideWaitingToolCalls(decideB, DECIDED_AT, CALL_B.id)).toBe(1);

      // ── Turn 2: the resume carries both decisions ──────────────────────────
      const turn2 = await runDeepAgentTurn(scenario, { turnSeq: 1 });
      expect(turn2.outcome.kind).toBe("returned");
      expect((turn2.outcome as { value: Record<string, unknown> }).value.phase).toBe("EXECUTION_COMPLETED");
      expect(record.persistedPhases.filter((p) => p === ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL)).toHaveLength(1);

      const rows = record.lastFullStatus!.messages.flatMap((m) => m.toolCalls);
      expect(rows.filter((tc) => tc.id === CALL_A.id), "one row per call, never duplicated").toHaveLength(1);
      expect(rows.filter((tc) => tc.id === CALL_B.id)).toHaveLength(1);
      expect(rows.find((tc) => tc.id === CALL_A.id)?.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
      expect(rows.find((tc) => tc.id === CALL_B.id)?.status).toBe(bStatus);
      expect(linesIn(env, "ran-a.log"), "the approved call ran exactly once").toBe(1);
      expect(linesIn(env, "ran-b.log")).toBe(bRuns);

      expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
    });
  });
});
