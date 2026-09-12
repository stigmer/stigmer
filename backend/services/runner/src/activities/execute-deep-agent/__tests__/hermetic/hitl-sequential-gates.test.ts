/**
 * Hermetic goldens: two SEQUENTIAL approval gates — three invocations on the
 * durable (sqlite) checkpointer.
 *
 * Turn 1 opens exactly as every gated arm does (the shared
 * `gate.turn1.status.json`): gated `execute` A, WAITING_FOR_APPROVAL.
 * APPROVE. Turn 2 resumes inside gate A, runs A, and the model proposes
 * gated `execute` B: the graph pauses again and the activity persists
 * WAITING_FOR_APPROVAL with BOTH rows — A COMPLETED (its committed identity
 * and result intact), B WAITING. APPROVE. Turn 3 resumes inside gate B, runs
 * B, the model closes, COMPLETED with both rows COMPLETED and each decision
 * recorded on its own row.
 *
 * Invariant carried from the retired `sequential-gate-resume.test.ts`: the
 * status persisted at gate B must hold gate A's already-committed tool-call
 * row — a status rebuilt from scratch that dropped it would trip the server's
 * append-only-at-identity guard and strand the execution in
 * WAITING_FOR_APPROVAL with zero pending approvals. That test modelled the
 * memory checkpointer's replay through a mocked graph. On the real graph the
 * memory posture (a test-only opt-in; `config.ts` resolves `sqlite` locally
 * and `http` in cloud) re-interrupts the same call on replay and duplicates
 * the row (S3 M0 finding F-M0-3), so the invariant is recorded on the durable
 * posture, where the reinvocation resumes instead of replaying.
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
  EXECUTE_CALL_B,
  GATED_OPENING_TURN,
  GATE_TURN1_GOLDEN,
  executeApprovalMessage,
} from "../../__test-utils__/hitl-script.js";

const USER_MESSAGE = "Run the command for me.";
const DECIDED_A_AT = "2026-01-01T00:00:30.000Z";
const DECIDED_B_AT = "2026-01-01T00:01:00.000Z";

function statusJson(status: AgentExecutionStatus): string {
  return JSON.stringify(toJson(AgentExecutionStatusSchema, status), null, 2) + "\n";
}

describe("ExecuteDeepAgent hermetic — two sequential gates (sqlite)", () => {
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

  it("keeps gate A's committed row through gate B's pause and completes after both approvals", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const record = deepAgentExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      checkpointer: "sqlite",
      script: () => ({
        turns: [
          GATED_OPENING_TURN,
          { text: "Now the second command.", toolCalls: [EXECUTE_CALL_B], usage: { inputTokens: 1_600, outputTokens: 40 } },
          CLOSING_TURN,
        ],
      }),
    });

    // ── Turn 1: gate A ───────────────────────────────────────────────────────
    const turn1 = await runDeepAgentTurn(scenario, { turnSeq: 0 });
    expect(turn1.outcome.kind).toBe("returned");
    expect(record.waitingToolCalls().map((tc) => tc.id)).toEqual([EXECUTE_CALL_A.id]);
    const atGateA = record.lastFullStatus!;
    await expect(statusJson(atGateA), "the same opening as every gated arm").toMatchFileSnapshot(GATE_TURN1_GOLDEN);
    expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE, DECIDED_A_AT)).toBe(1);

    // ── Turn 2: A runs, gate B pauses ────────────────────────────────────────
    const turn2 = await runDeepAgentTurn(scenario, { turnSeq: 1 });
    expect(turn2.outcome.kind).toBe("returned");
    expect((turn2.outcome as { value: Record<string, unknown> }).value.phase).toBe("EXECUTION_WAITING_FOR_APPROVAL");
    const atGateB = record.lastFullStatus!;
    const rowsAtB = atGateB.messages.flatMap((m) => m.toolCalls);
    expect(rowsAtB.map((tc) => [tc.id, tc.status]), "A committed and kept, B waiting").toEqual([
      [EXECUTE_CALL_A.id, ToolCallStatus.TOOL_CALL_COMPLETED],
      [EXECUTE_CALL_B.id, ToolCallStatus.TOOL_CALL_WAITING_APPROVAL],
    ]);
    expect(rowsAtB[0].result).toContain("hermetic-a");
    expect(rowsAtB[0].approvalAction).toBe(ApprovalAction.APPROVE);
    expect(rowsAtB[1].approvalMessage).toBe(executeApprovalMessage(EXECUTE_CALL_B));
    expect(record.waitingToolCalls().map((tc) => tc.id), "exactly one pending approval").toEqual([EXECUTE_CALL_B.id]);
    // The gate-B transcript is a superset of the gate-A one: every id, every message, in order.
    const gateAIds = atGateA.messages.flatMap((m) => m.toolCalls).map((tc) => tc.id);
    expect(rowsAtB.map((tc) => tc.id).slice(0, gateAIds.length)).toEqual(gateAIds);
    expect(atGateB.messages.length).toBeGreaterThanOrEqual(atGateA.messages.length);
    await expect(statusJson(atGateB)).toMatchFileSnapshot("./goldens/sequential-gates.turn2.status.json");
    expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE, DECIDED_B_AT)).toBe(1);

    // ── Turn 3: B runs, the run completes ────────────────────────────────────
    const turn3 = await runDeepAgentTurn(scenario, { turnSeq: 2 });
    expect(turn3.outcome.kind).toBe("returned");
    expect((turn3.outcome as { value: Record<string, unknown> }).value.phase).toBe("EXECUTION_COMPLETED");
    expect(record.persistedPhases.filter((p) => p === ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL)).toHaveLength(2);
    const final = record.lastFullStatus!;
    const rows = final.messages.flatMap((m) => m.toolCalls);
    expect(rows.map((tc) => [tc.id, tc.status, tc.approvalAction, tc.approvalDecidedAt])).toEqual([
      [EXECUTE_CALL_A.id, ToolCallStatus.TOOL_CALL_COMPLETED, ApprovalAction.APPROVE, DECIDED_A_AT],
      [EXECUTE_CALL_B.id, ToolCallStatus.TOOL_CALL_COMPLETED, ApprovalAction.APPROVE, DECIDED_B_AT],
    ]);
    expect(rows[1].result).toContain("hermetic-b");

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    await expect(statusJson(final)).toMatchFileSnapshot("./goldens/sequential-gates.turn3.status.json");
  });
});
