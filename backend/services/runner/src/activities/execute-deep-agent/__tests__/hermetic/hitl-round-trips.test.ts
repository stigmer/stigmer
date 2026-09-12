/**
 * Hermetic goldens: the three HITL round trips — APPROVE, SKIP, REJECT — each
 * two invocations of the whole `ExecuteDeepAgent` activity on the durable
 * (sqlite) checkpointer, the production local posture (`config.ts` resolves
 * `sqlite` in local mode and `http` in cloud; both resume the same way).
 *
 * Turn 1 (shared by every arm, ONE golden `gate.turn1.status.json`): the
 * model proposes a gated `execute`; the gate's `interrupt()` pauses the graph;
 * the post-stream interrupt detection seeds a WAITING_APPROVAL row carrying
 * the gate's message and provenance; the activity persists
 * WAITING_FOR_APPROVAL and RETURNS. That the approve, skip and reject arms all
 * match the same file is the assertion that the decision to come is invisible
 * to the first invocation.
 *
 * Between turns the test does what the server's `SubmitApproval` does — writes
 * `approval_action` on the WAITING row (`ExecutionRecord.decideWaitingToolCalls`),
 * nothing else — and the second invocation reads the real persisted status.
 *
 * Turn 2 (one golden per decision): the activity seeds its status from the
 * persisted transcript (`shouldSeedFromPersistedTranscript`), reads the
 * checkpoint's pending interrupt, builds `Command({ resume })` from the
 * decision (`hitl.ts`), and the graph resumes INSIDE the gate:
 *  - APPROVE: the tool runs; the row is reconciled IN PLACE to COMPLETED with
 *    the command's output (exactly one copy of the gated call, the run-1
 *    transcript a strict prefix of the final one — `hitl-resume-history`'s
 *    invariant), the model closes, COMPLETED.
 *  - SKIP: the gate returns a "skipped by user" ToolMessage; the tool never
 *    runs; `reconcileNonExecutingDecisions` stamps the row SKIPPED after the
 *    stream; COMPLETED.
 *  - REJECT (issue #197, `hitl-reject`'s invariant): the gate returns a denial
 *    ToolMessage and the run CONTINUES; the row is stamped SKIPPED with
 *    `error: "Rejected by user"` and keeps `approvalAction = REJECT` for
 *    audit; COMPLETED, never stuck at WAITING_APPROVAL.
 *
 * Carried from the retired `hitl-reject.test.ts` (both arms), `hitl-resume-
 * history.test.ts` (seed + single copy), `hitl-resume-approve-all.test.ts`'s
 * superset assertion (the leased variant lives in `hitl-approve-all-lease`).
 *
 * The REJECT arm is what Q-S3-2 aligns the runtime to (REJECT continues on
 * both harnesses); this golden is the native truth it must reproduce.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-deep-agent/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import {
  AgentExecutionStatusSchema,
  type AgentExecutionStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ApprovalAction,
  ExecutionPhase,
  MessageType,
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
  runDeepAgentTurn,
} from "../../__test-utils__/hermetic-deep-agent.js";
import {
  CLOSING_TURN,
  EXECUTE_CALL_A,
  GATED_OPENING_TURN,
  GATE_TURN1_GOLDEN,
  executeApprovalMessage,
} from "../../__test-utils__/hitl-script.js";

const USER_MESSAGE = "Run the command for me.";
const DECIDED_AT = "2026-01-01T00:00:30.000Z";

function statusJson(status: AgentExecutionStatus): string {
  return JSON.stringify(toJson(AgentExecutionStatusSchema, status), null, 2) + "\n";
}

describe("ExecuteDeepAgent hermetic — HITL round trips (sqlite)", () => {
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
    { name: "approve", action: ApprovalAction.APPROVE },
    { name: "skip", action: ApprovalAction.SKIP },
    { name: "reject", action: ApprovalAction.REJECT },
  ])("$name", ({ name, action }) => {
    it(`pauses on the gate, then ${name} carries the decision to COMPLETED`, async () => {
      // ── Arrange ────────────────────────────────────────────────────────────
      clock.reset();
      const record = deepAgentExecutionRecord({ message: USER_MESSAGE });
      const scenario = beginDeepAgentScenario({
        env,
        clock,
        record,
        checkpointer: "sqlite",
        script: () => ({ turns: [GATED_OPENING_TURN, CLOSING_TURN] }),
      });

      // ── Act 1: the gate pauses the turn ────────────────────────────────────
      const turn1 = await runDeepAgentTurn(scenario, { turnSeq: 0 });

      // ── Assert 1: WAITING_FOR_APPROVAL, one WAITING row, returned ──────────
      expect(turn1.outcome.kind, "an approval pause RETURNS").toBe("returned");
      expect((turn1.outcome as { value: Record<string, unknown> }).value.phase).toBe(
        "EXECUTION_WAITING_FOR_APPROVAL",
      );
      expect(record.persistedPhases).toEqual([
        ExecutionPhase.EXECUTION_IN_PROGRESS,
        ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      ]);
      const waiting = record.waitingToolCalls();
      expect(waiting).toHaveLength(1);
      expect(waiting[0].id).toBe(EXECUTE_CALL_A.id);
      expect(waiting[0].name).toBe("execute");
      expect(waiting[0].requiresApproval).toBe(true);
      expect(waiting[0].approvalMessage).toBe(executeApprovalMessage(EXECUTE_CALL_A));
      expect(waiting[0].approvalAction, "no decision yet").toBe(ApprovalAction.UNSPECIFIED);
      const run1 = record.lastFullStatus!;
      await expect(statusJson(run1), "every decision's first turn is the same status").toMatchFileSnapshot(
        GATE_TURN1_GOLDEN,
      );

      // ── Between turns: what SubmitApproval does to the row ─────────────────
      expect(record.decideWaitingToolCalls(action, DECIDED_AT)).toBe(1);

      // ── Act 2: the reinvocation resumes inside the gate ────────────────────
      const turn2 = await runDeepAgentTurn(scenario, { turnSeq: 1 });

      // ── Assert 2: COMPLETED, the row terminal, one copy, run 1 preserved ───
      expect(turn2.outcome.kind).toBe("returned");
      expect((turn2.outcome as { value: Record<string, unknown> }).value.phase).toBe("EXECUTION_COMPLETED");
      expect(record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_COMPLETED);

      const final = record.lastFullStatus!;
      const rows = final.messages.flatMap((m) => m.toolCalls).filter((tc) => tc.id === EXECUTE_CALL_A.id);
      expect(rows, "exactly one copy of the gated call — reconciled in place, never duplicated").toHaveLength(1);
      const row = rows[0];
      expect(row.approvalAction, "the decision is preserved for audit").toBe(action);
      expect(row.approvalDecidedAt).toBe(DECIDED_AT);
      expect(row.status, "never left at WAITING_APPROVAL").not.toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
      if (action === ApprovalAction.APPROVE) {
        expect(row.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
        expect(row.result, "the command ran").toContain("hermetic-a");
        expect(row.error).toBe("");
      } else {
        expect(row.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
        expect(row.result, "the tool never ran").toBe("");
        expect(row.error).toBe(action === ApprovalAction.REJECT ? "Rejected by user" : "");
      }

      const run1Ai = run1.messages.filter((m) => m.type === MessageType.MESSAGE_AI).map((m) => m.content);
      const finalAi = final.messages.filter((m) => m.type === MessageType.MESSAGE_AI).map((m) => m.content);
      expect(finalAi.slice(0, run1Ai.length), "run 1's transcript survives the resume as a prefix").toEqual(run1Ai);
      expect(finalAi.at(-1)).toBe(CLOSING_TURN.text);
      expect(final.completedAt).not.toBe("");

      // ── Assert: hermeticity ────────────────────────────────────────────────
      expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

      // ── Assert: the golden ─────────────────────────────────────────────────
      await expect(statusJson(final)).toMatchFileSnapshot(`./goldens/${name}.turn2.status.json`);
    });
  });
});
