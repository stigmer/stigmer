/**
 * Hermetic golden: the TOOL-CALL BUDGET — `max_tool_rounds` exhausted by a
 * model that keeps calling tools.
 *
 * What the arm does: `max_tool_rounds = 10` (the clamp floor,
 * `shared/tool-rounds.ts` MIN_TOOL_ROUNDS) becomes LangGraph's
 * `recursionLimit = 60` (SUPER_STEPS_PER_ROUND); the script proposes a
 * DISTINCT `read_file` every round (distinct ids and paths, so the
 * loop-detection middleware's "repetitive pattern" warning does not end the
 * run first); the graph throws `GraphRecursionError`; the adapter's turn
 * classifies it as the `tool_call_limit` outcome (`shared/tool-rounds.ts`
 * `isGraphRecursionError`), and the runtime's `toolCallLimitArm` writes
 * TERMINATED with the cross-repo prefix `TOOL_CALL_LIMIT_ERROR_PREFIX`
 * (matched with `startsWith` by stigmer-cloud's `reply-extractor.ts`) and
 * its row, PERSISTS it, and returns the slim.
 *
 * Ruled at Q-S3-6 and landed at S3 M2a. Until then the orchestrator RETURNED
 * the TERMINATED status but never PERSISTED it (S3 M0 finding F-M0-4, a
 * production defect): the last status the control plane held was the
 * stream's mid-run IN_PROGRESS with no error, and only the activity's return
 * value carried the truth. The golden
 * (`goldens/recursion-limit.persisted.status.json`) now records the
 * TERMINATED status the control plane holds, which is what that fix changed
 * on purpose.
 *
 * Also visible here, Q-S4-5 at scale (S4 M2 C4): every tool row sits on the
 * "Reading file N." message whose text proposed it. Until C4 all of them sat
 * on ONE empty AI message (F-M0-1 at scale): the namespace miss created the
 * empty message once and its `currentAiMessage[""]` then caught every later
 * row.
 *
 * How many rounds fit is the middleware stack's shape, not the knob's
 * (S3 M2b, owner ruling 2026-09-13 on F-M2b-26): LangChain makes every
 * middleware hook its own graph node, and `max_tool_rounds` becomes a
 * super-step budget at the ×6 floor estimate, so a node fewer per round
 * means more rounds within the same 60 steps. When `graceful-stop.ts` (an
 * `afterModel` node) was deleted with Q-S3-3, this golden went from 11 tool
 * calls to 13 before TERMINATED — the only hunk, the copy unchanged. That the
 * knob counts super-steps and not rounds is recorded as an S5 design item
 * (a round counter in the budget middleware would make it mean what it
 * says); this file pins what the stack delivers today.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-deep-agent/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase, MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

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
import { MIN_TOOL_ROUNDS } from "../../../../shared/tool-rounds.js";
import {
  beginDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
} from "../../__test-utils__/hermetic-deep-agent.js";
import { TOOL_CALL_LIMIT_ERROR_PREFIX } from "../../../../shared/tool-rounds.js";

/** More rounds than the budget allows; the graph stops the script, not the other way round. */
const SCRIPTED_ROUNDS = 40;

describe("ExecuteDeepAgent hermetic — tool-call budget exhausted", () => {
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

  it("returns TERMINATED with the cross-repo prefix, and persists nothing past IN_PROGRESS (F-M0-4)", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const record = deepAgentExecutionRecord({ message: "Keep reading files.", maxToolRounds: MIN_TOOL_ROUNDS });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => ({
        turns: Array.from({ length: SCRIPTED_ROUNDS }, (_, i) => ({
          text: `Reading file ${i}.`,
          toolCalls: [{ id: `call-hermetic-loop-${String(i).padStart(4, "0")}`, name: "read_file", args: { file_path: `/f${i}.md` } }],
          usage: { inputTokens: 1_000, outputTokens: 20 },
        })),
      }),
    });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runDeepAgentTurn(scenario);

    // ── Assert: the slim the workflow receives ───────────────────────────────
    expect(invocation.outcome.kind).toBe("returned");
    const slim = (invocation.outcome as { value: Record<string, unknown> }).value;
    expect(slim.phase).toBe("EXECUTION_TERMINATED");
    expect(String(slim.error).startsWith(TOOL_CALL_LIMIT_ERROR_PREFIX), "the cross-repo prefix").toBe(true);

    // ── Assert: what the control plane holds (F-M0-4 closed) ─────────────────
    expect(record.persistedPhases, "the TERMINATED terminal is persisted").toEqual([
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_TERMINATED,
    ]);
    const persisted = record.lastFullStatus!;
    expect(String(persisted.error).startsWith(TOOL_CALL_LIMIT_ERROR_PREFIX), "the persisted error carries the prefix").toBe(true);
    expect(persisted.error, "the event count left the copy (Q-S3-6)").not.toMatch(/\d+ events?/);
    expect(persisted.completedAt).not.toBe("");
    const rows = record.toolCalls();
    expect(rows.length, "fewer rounds ran than were scripted: the budget stopped the graph").toBeLessThan(SCRIPTED_ROUNDS);
    expect(rows.length).toBeGreaterThanOrEqual(MIN_TOOL_ROUNDS);
    // Q-S4-5 (S4 M2 C4): every row sits on the message whose text proposed it
    // — one "Reading file N." message per row, no empty host (until C4 all
    // thirteen rows sat on ONE empty message, F-M0-1 at scale).
    const rowHosts = persisted.messages.filter((m) => m.type === MessageType.MESSAGE_AI && m.toolCalls.length > 0);
    expect(rowHosts).toHaveLength(rows.length);
    for (const host of rowHosts) {
      expect(host.content).toMatch(/^Reading file \d+\.$/);
      expect(host.toolCalls).toHaveLength(1);
    }

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, persisted), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/recursion-limit.persisted.status.json");
  });
});
