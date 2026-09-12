/**
 * Hermetic golden: APPROVE_ALL leases the gated action's CLASS for the rest
 * of the run — two invocations on the durable (sqlite) checkpointer.
 *
 * Turn 1: the model thinks (a leading reasoning block, persisted as a
 * THINKING message), says it will run two commands, and proposes the first
 * gated `execute`; the gate pauses; WAITING_FOR_APPROVAL.
 *
 * Between turns: APPROVE_ALL on the WAITING row. `deriveActiveLeases`
 * reduces it to the scope of the tool it was made on — for a built-in, its
 * approval category (`shared/approval-policy.ts` `deriveLeaseScope`), here
 * SHELL — and the reinvocation's gate carries that lease.
 *
 * Turn 2: the graph resumes inside the gate and runs command A; the model
 * proposes command B; the gate finds SHELL leased and runs B WITHOUT a second
 * interrupt (`ToolCall.approvalPolicySource` records the lease as the
 * authorization); the model closes; COMPLETED.
 *
 * Invariants carried from the retired `hitl-resume-approve-all.test.ts`
 * (the user-reported "leading thinking block and the first tool call vanish
 * after approve-all" regression): the final status is a strict SUPERSET of
 * run 1's transcript — the THINKING message survives, the gated call is
 * reconciled in place (exactly one copy, now COMPLETED), and the leased
 * follow-up is appended COMPLETED with no interrupt. That test leased an MCP
 * SERVER (`getAppState` on open-computer-use); this arm leases a CATEGORY,
 * the same `deriveLeaseScope` path with the other scope kind (S3 M0 ruling
 * Q-M0-4). The server-scoped lease stays pinned by `approval-policy`'s unit
 * tests and the conformance execution class.
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
  ApprovalPolicySource,
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
import { CLOSING_TURN, EXECUTE_CALL_A, EXECUTE_CALL_B } from "../../__test-utils__/hitl-script.js";

const USER_MESSAGE = "Run both commands.";
const REASONING = "Two commands are needed; I will run them in order.";
const OPENING_TEXT = "I will run the two commands.";
const DECIDED_AT = "2026-01-01T00:00:30.000Z";

function statusJson(status: AgentExecutionStatus): string {
  return JSON.stringify(toJson(AgentExecutionStatusSchema, status), null, 2) + "\n";
}

describe("ExecuteDeepAgent hermetic — APPROVE_ALL leases the class (sqlite)", () => {
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

  it("runs the approved call and the leased follow-up in one resume, keeping the leading thinking", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const record = deepAgentExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      checkpointer: "sqlite",
      script: () => ({
        turns: [
          {
            reasoning: REASONING,
            text: OPENING_TEXT,
            toolCalls: [EXECUTE_CALL_A],
            usage: { inputTokens: 1_400, outputTokens: 80 },
          },
          { toolCalls: [EXECUTE_CALL_B], usage: { inputTokens: 1_600, outputTokens: 40 } },
          CLOSING_TURN,
        ],
      }),
    });

    // ── Act 1 ────────────────────────────────────────────────────────────────
    const turn1 = await runDeepAgentTurn(scenario, { turnSeq: 0 });

    // ── Assert 1: paused on A, the thinking persisted ────────────────────────
    expect(turn1.outcome.kind).toBe("returned");
    expect(record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL);
    const run1 = record.lastFullStatus!;
    const thinking = run1.messages.filter((m) => m.type === MessageType.MESSAGE_THINKING);
    expect(thinking.map((m) => m.content), "the reasoning block is a THINKING message").toEqual([REASONING]);
    expect(record.waitingToolCalls().map((tc) => tc.id)).toEqual([EXECUTE_CALL_A.id]);
    await expect(statusJson(run1)).toMatchFileSnapshot("./goldens/approve-all-lease.turn1.status.json");

    // ── Between turns: APPROVE_ALL on A ──────────────────────────────────────
    expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE_ALL, DECIDED_AT)).toBe(1);

    // ── Act 2 ────────────────────────────────────────────────────────────────
    const turn2 = await runDeepAgentTurn(scenario, { turnSeq: 1 });

    // ── Assert 2: A ran, B ran under the lease, no second interrupt ──────────
    expect(turn2.outcome.kind).toBe("returned");
    expect((turn2.outcome as { value: Record<string, unknown> }).value.phase).toBe("EXECUTION_COMPLETED");
    expect(record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    expect(record.persistedPhases.filter((p) => p === ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL)).toHaveLength(1);

    const final = record.lastFullStatus!;
    const rows = final.messages.flatMap((m) => m.toolCalls);
    expect(rows.map((tc) => tc.id), "A reconciled in place, B appended; one copy each").toEqual([
      EXECUTE_CALL_A.id,
      EXECUTE_CALL_B.id,
    ]);
    const [a, b] = rows;
    expect(a.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(a.approvalAction).toBe(ApprovalAction.APPROVE_ALL);
    expect(a.result).toContain("hermetic-a");
    expect(b.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(b.requiresApproval, "the leased class needs no interrupt").toBe(false);
    expect(b.approvalPolicySource, "the lease is B's recorded authorization").toBe(
      ApprovalPolicySource.APPROVAL_LEASE,
    );
    expect(b.approvalAction, "B was never decided by a person").toBe(ApprovalAction.UNSPECIFIED);
    expect(b.result).toContain("hermetic-b");

    // The superset invariant: every run-1 message survives, in order, at the front.
    const run1Shape = run1.messages.map((m) => [m.type, m.content]);
    const finalShape = final.messages.map((m) => [m.type, m.content]);
    expect(finalShape.slice(0, run1Shape.length), "run 1's transcript is a prefix of the final").toEqual(run1Shape);
    expect(finalShape.at(-1)).toEqual([MessageType.MESSAGE_AI, CLOSING_TURN.text]);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    await expect(statusJson(final)).toMatchFileSnapshot("./goldens/approve-all-lease.turn2.status.json");
  });
});
