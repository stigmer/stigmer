/**
 * Hermetic goldens: the three HITL round trips — an allow, a bare deny (the
 * `skip` golden: what a person's Skip is since approvals became session
 * events) and a deny with a reason (the `reject` golden) — each
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
 * Between turns the test does what the server's answer core does — appends
 * the `user.tool_confirmation` to the session's log and stamps
 * `approval_action` on the WAITING row (`ExecutionRecord.decideWaitingToolCalls`),
 * nothing else — and the second invocation reads the answer from the log
 * (`harness/approval-answers.ts`) over the real persisted status.
 *
 * Turn 2 (one golden per decision): the activity seeds its status from the
 * persisted transcript (`shouldSeedFromPersistedTranscript`), reads the
 * checkpoint's pending interrupt, builds `Command({ resume })` from the
 * decision (`hitl.ts`), and the graph resumes INSIDE the gate:
 *  - APPROVE: the tool runs; the row is reconciled IN PLACE to COMPLETED with
 *    the command's output (exactly one copy of the gated call, the run-1
 *    transcript a strict prefix of the final one — `hitl-resume-history`'s
 *    invariant), the model closes, COMPLETED.
 *  - a deny, bare or with a reason (issue #197, `hitl-reject`'s invariant):
 *    the gate returns a denial ToolMessage and the run CONTINUES; the row is
 *    stamped SKIPPED with `error: "Rejected by user"` and keeps
 *    `approvalAction = REJECT` for audit; COMPLETED, never stuck at
 *    WAITING_APPROVAL. A reason is in the denial the model reads.
 *
 * Carried from the retired `hitl-reject.test.ts` (both arms), `hitl-resume-
 * history.test.ts` (seed + single copy), `hitl-resume-approve-all.test.ts`'s
 * superset assertion (the leased variant lives in `hitl-approve-all-lease`).
 *
 * The REJECT arm is what #1096 aligned the runtime to (REJECT continues on
 * both harnesses); this golden is the native truth it must reproduce.
 *
 * What every reinvocation golden here shows since #1096 (the runtime over
 * the native adapter): `startedAt` is THIS turn's own,
 * not turn 1's carried by the orchestrator's whole-status clone; the
 * `fileReviewEventStream` carries only the events THIS turn authored (the
 * runtime seeds messages, sub-agents, artifacts, write-backs, todos, usage,
 * the memory report and the structured output — never the server-owned
 * ledgers, which the server appends to by event id in `update-status.ts`
 * `appendRunnerEvents`; the hermetic record replaces wholesale, so a
 * golden reads as what the runner SENT); and `streamingUsage` carries the
 * runtime accountant's fields (`model`, `estimatedCostUsd`, the requested
 * tier and thinking mode).
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-deep-agent/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ToolMessage } from "@langchain/core/messages";
import {
  RunPhase,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

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
  statusGolden,
  rowsGolden,
  rowsGoldenPath,
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
import { ApprovalAction, MessageType, ToolCallStatus } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

const USER_MESSAGE = "Run the command for me.";
const DECIDED_AT = "2026-01-01T00:00:30.000Z";


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
    { name: "approve", action: ApprovalAction.APPROVE, denyMessage: "" },
    { name: "skip", action: ApprovalAction.SKIP, denyMessage: "" },
    { name: "reject", action: ApprovalAction.REJECT, denyMessage: "use make clean instead" },
  ])("$name", ({ name, action, denyMessage }) => {
    it(`pauses on the gate, then ${name} carries the decision to COMPLETED`, async () => {
      // ── Arrange ────────────────────────────────────────────────────────────
      clock.reset();
      const record = deepAgentExecutionRecord({ message: USER_MESSAGE });
      // What the model reads back for the gated call: the tool's output, or
      // the denial (with the person's reason, when they gave one).
      const toolResultsRead: string[] = [];
      const scenario = beginDeepAgentScenario({
        env,
        clock,
        record,
        checkpointer: "sqlite",
        script: () => (transcript) => {
          const answered = transcript.filter((m) => ToolMessage.isInstance(m));
          if (answered.length === 0) return GATED_OPENING_TURN;
          toolResultsRead.push(...answered.map((m) => String(m.content)));
          return CLOSING_TURN;
        },
      });

      // ── Act 1: the gate pauses the turn ────────────────────────────────────
      const turn1 = await runDeepAgentTurn(scenario, { turnSeq: 0 });

      // ── Assert 1: WAITING_FOR_APPROVAL, one WAITING row, returned ──────────
      expect(turn1.outcome.kind, "an approval pause RETURNS").toBe("returned");
      expect((turn1.outcome as { value: Record<string, unknown> }).value.phase).toBe(
        "RUN_WAITING_FOR_APPROVAL",
      );
      expect(record.persistedPhases).toEqual([
        RunPhase.RUN_IN_PROGRESS,
        RunPhase.RUN_WAITING_FOR_APPROVAL,
      ]);
      const waiting = record.waitingToolCalls();
      expect(waiting).toHaveLength(1);
      expect(waiting[0].id).toBe(EXECUTE_CALL_A.id);
      expect(waiting[0].name).toBe("execute");
      expect(waiting[0].requiresApproval).toBe(true);
      expect(waiting[0].approvalMessage).toBe(executeApprovalMessage(EXECUTE_CALL_A));
      expect(waiting[0].approvalAction, "no decision yet").toBe(ApprovalAction.UNSPECIFIED);
      const run1 = record.lastFullStatus!;
      const run1Rows = record.rowsOf(run1);
      await expect(statusGolden(run1), "every decision's first turn is the same status").toMatchFileSnapshot(GATE_TURN1_GOLDEN);
      await expect(rowsGolden(record.rowsOf(run1)), "every decision's first turn is the same status").toMatchFileSnapshot(rowsGoldenPath(GATE_TURN1_GOLDEN));
      await expect(record.eventsGolden()).toMatchFileSnapshot(GATE_TURN1_GOLDEN.replace(".status.json", ".events.json"));

      // ── Between turns: the server's answer, on the log and the row ─────────
      expect(record.decideWaitingToolCalls(action, DECIDED_AT, undefined, denyMessage)).toBe(1);
      expect(
        record.sessionEvents.filter((e) => e.event.case === "userToolConfirmation").length,
        "the answer is on the session's log",
      ).toBe(1);

      // ── Act 2: the reinvocation resumes inside the gate ────────────────────
      const turn2 = await runDeepAgentTurn(scenario, { turnSeq: 1 });

      // ── Assert 2: COMPLETED, the row terminal, one copy, run 1 preserved ───
      expect(turn2.outcome.kind).toBe("returned");
      expect((turn2.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
      expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);

      const final = record.lastFullStatus!;
      const finalRows = record.rowsOf(final);
      const rows = finalRows.messages.flatMap((m) => m.toolCalls).filter((tc) => tc.id === EXECUTE_CALL_A.id);
      expect(rows, "exactly one copy of the gated call — reconciled in place, never duplicated").toHaveLength(1);
      const row = rows[0];
      expect(row.approvalAction, "the decision is preserved for audit; any deny is a REJECT").toBe(
        action === ApprovalAction.APPROVE ? ApprovalAction.APPROVE : ApprovalAction.REJECT,
      );
      expect(row.status, "never left at WAITING_APPROVAL").not.toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
      if (action === ApprovalAction.APPROVE) {
        expect(row.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
        expect(row.result, "the command ran").toContain("hermetic-a");
        expect(row.error).toBe("");
      } else {
        expect(row.status).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
        expect(row.result, "the tool never ran").toBe("");
        expect(row.error).toBe("Rejected by user");
        expect(toolResultsRead, "the model reads the denial, with the person's reason when given").toEqual([
          denyMessage === ""
            ? "Tool 'execute' was rejected by the user. Do not retry it; proceed by taking their objection into account."
            : `Tool 'execute' was rejected by the user: ${denyMessage}. Do not retry it; proceed by taking their objection into account.`,
        ]);
      }

      // Run 1's transcript is the log's: written once by run 1 and never
      // carried, so the resumed rows hold only their own text.
      const run1Ai = run1Rows.messages.filter((m) => m.type === MessageType.MESSAGE_AI && m.content !== "").map((m) => m.content);
      const finalAi = finalRows.messages.filter((m) => m.type === MessageType.MESSAGE_AI && m.content !== "").map((m) => m.content);
      const logged = record.sessionEvents.flatMap((e) => (e.event.case === "agentMessage" ? e.event.value.content.map((c) => c.text) : []));
      expect(logged.slice(0, run1Ai.length), "run 1's transcript survives the resume in the log").toEqual(run1Ai);
      expect(finalAi, "the resumed rows hold their own text alone").toEqual([CLOSING_TURN.text]);
      expect(final.completedAt).not.toBe("");

      // ── Assert: hermeticity ────────────────────────────────────────────────
      expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

      // ── Assert: the golden ─────────────────────────────────────────────────
      await expect(statusGolden(final)).toMatchFileSnapshot(`./goldens/${name}.turn2.status.json`);
      await expect(rowsGolden(record.rowsOf(final))).toMatchFileSnapshot(rowsGoldenPath(`./goldens/${name}.turn2.status.json`));
      await expect(record.eventsGolden()).toMatchFileSnapshot(`./goldens/${name}.turn2.events.json`);
    });
  });
});
