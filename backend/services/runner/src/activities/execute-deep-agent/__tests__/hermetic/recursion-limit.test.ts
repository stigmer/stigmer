/**
 * Hermetic golden: the TOOL-CALL BUDGET — `max_tool_rounds` exhausted by a
 * model that keeps calling tools.
 *
 * What the arm does: `max_tool_rounds = 10` (the clamp floor,
 * `shared/tool-rounds.ts` MIN_TOOL_ROUNDS) becomes LangGraph's
 * `recursionLimit = 60` (SUPER_STEPS_PER_ROUND); the script proposes a
 * DISTINCT `read_file` every round (distinct ids and paths, so the
 * loop-detection middleware's "repetitive pattern" warning does not end the
 * run first); the graph throws `GraphRecursionError`; the stream loop's
 * `handleRecursionLimit` marks the status TERMINATED with the cross-repo
 * prefix `TOOL_CALL_LIMIT_ERROR_PREFIX` (matched with `startsWith` by
 * stigmer-cloud's `reply-extractor.ts`) and hands the slim back.
 *
 * What the golden shows about TODAY's behavior, recorded as found (S3 M0
 * finding F-M0-4, a production defect for the owner): the TERMINATED status
 * is RETURNED but never PERSISTED. `index.ts` treats a recursion limit as an
 * "abnormal terminal" and skips the capture-mode persist, then returns
 * `result.terminalStatus` with no persist of its own; the workflow's
 * `persistFinalStatus` fallback runs only for a returned FAILED. So the last
 * status the control plane holds is the stream's mid-run IN_PROGRESS, with the
 * tool rows, and no error. The activity's return value carries the truth; the
 * database does not. Q-S3-6's `tool_call_limit` outcome makes the runtime's
 * TERMINATED arm the one persisted terminal at M2b; this golden
 * (`goldens/recursion-limit.persisted.status.json`) is what that fix changes
 * on purpose. The slim is pinned in code.
 *
 * Also visible here, F-M0-1 at scale: every tool row of the run sits on ONE
 * empty AI message, because `ensureAiMessageForToolCall("")` creates it once
 * and `currentAiMessage[""]` then catches every later row.
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

    // ── Assert: what the control plane holds (F-M0-4) ────────────────────────
    expect(record.persistedPhases, "no terminal was ever persisted").toEqual([ExecutionPhase.EXECUTION_IN_PROGRESS]);
    const persisted = record.lastFullStatus!;
    expect(persisted.error).toBe("");
    expect(persisted.completedAt).toBe("");
    const rows = record.toolCalls();
    expect(rows.length, "fewer rounds ran than were scripted: the budget stopped the graph").toBeLessThan(SCRIPTED_ROUNDS);
    expect(rows.length).toBeGreaterThanOrEqual(MIN_TOOL_ROUNDS);
    const rowHosts = persisted.messages.filter((m) => m.type === MessageType.MESSAGE_AI && m.toolCalls.length > 0);
    expect(rowHosts, "F-M0-1: every row on one empty AI message").toHaveLength(1);
    expect(rowHosts[0].content).toBe("");

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, persisted), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/recursion-limit.persisted.status.json");
  });
});
