/**
 * Hermetic golden: an UNGATED tool call that FAILS — a `read` the SDK streams
 * as `running` and then `error` with the failure text as its result — through
 * the whole `ExecuteCursor` activity.
 *
 * Invariant pinned (S4 M0 net): the error event folds onto the same row
 * (`MessageAccumulator.mergeToolCallEvent`) as FAILED, with `error` AND
 * `result` both set to the failure text, `completedAt` stamped, no approval
 * fields (a read-only built-in is not gated, and the text is not Cursor's
 * hook-block copy, so the boundary's #205 pass leaves it alone), and the turn
 * still ends COMPLETED: a failed read is the model's problem to route around,
 * not the turn's.
 *
 * Predicted under the S4 rulings (`T01_1_review.md`, 2026-09-14): NO move.
 * The canonical builder's `tool_error` upsert (Q-S4-3(c)) stamps the same
 * fields; `startedAt` is already present because the `running` event came
 * first (Q-S4-17 touches only completed-without-running rows).
 *
 * Why this net exists: the one FAILED row among the seventeen Cursor goldens
 * is the gate's own case (`unattributed-hook-block`); the ordinary tool
 * failure — the fold M4 rewrites — had no end-to-end net.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-cursor/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

vi.mock("@cursor/sdk", async () =>
  (await import("../../__test-utils__/scripted-sdk.js")).scriptedCursorSdkModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import {
  ScriptedClock,
  createHermeticEnvironment,
  type HermeticEnvironment,
} from "../../../../__test-utils__/hermetic-activity.js";
import { ScriptedCursorAgent, sdkEvents, step } from "../../__test-utils__/scripted-agent.js";
import {
  FIXTURE,
  SDK_CATALOG,
  beginCursorScenario,
  cursorExecutionRecord,
  runCursorTurn,
} from "../../__test-utils__/hermetic-cursor.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";

const AGENT_ID = "agent-hermetic-toolerror-0001";
const RUN_ID = "run-hermetic-toolerror-0001";
const CALL_ID = "call-hermetic-toolerror-read-0001";
const USER_MESSAGE = "What is in MISSING.md?";
const TEXT_BEFORE = "Let me read it.";
const READ_ARGS = { path: "MISSING.md" };
const READ_ERROR = "ENOENT: no such file or directory, open 'MISSING.md'";
const TEXT_AFTER = "There is no MISSING.md in this workspace.";

describe("ExecuteCursor hermetic — an ungated tool call that fails", () => {
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

  it("folds running -> error into one FAILED row carrying the failure text and completes", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const ev = sdkEvents(AGENT_ID, RUN_ID);
    const agent = new ScriptedCursorAgent({
      agentId: AGENT_ID,
      runIds: [RUN_ID],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev.init()),
          step.event(ev.assistant(TEXT_BEFORE)),
          step.event(ev.toolCall(CALL_ID, "read", "running", READ_ARGS)),
          step.event(ev.toolCall(CALL_ID, "read", "error", READ_ARGS, READ_ERROR)),
          step.event(ev.assistant(TEXT_AFTER)),
          step.turnEnded({ inputTokens: 1_900, outputTokens: 70 }),
          step.finished({ result: TEXT_AFTER, model: { id: FIXTURE.model, params: [] } }),
        ],
      ],
    });
    const record = cursorExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginCursorScenario({
      env,
      clock,
      record,
      sdk: { agents: [agent], catalog: SDK_CATALOG },
    });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runCursorTurn(scenario);

    // ── Assert: a failed read does not fail the turn ─────────────────────────
    expect(invocation.outcome.kind).toBe("returned");
    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("EXECUTION_COMPLETED");
    expect(record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_COMPLETED);

    // ── Assert: the one FAILED row ───────────────────────────────────────────
    const rows = record.toolCalls();
    expect(rows, "running + error fold into ONE row").toHaveLength(1);
    const row = rows[0];
    expect(row.id).toBe(CALL_ID);
    expect(row.status).toBe(ToolCallStatus.TOOL_CALL_FAILED);
    expect(row.error, "the failure text is the error").toBe(READ_ERROR);
    expect(row.result, "and, as the accumulator folds it today, also the result").toBe(READ_ERROR);
    expect(row.requiresApproval, "an ordinary failure is not an approval gate").toBe(false);
    expect(row.approvalRequestedAt).toBe("");
    expect(row.startedAt < row.completedAt).toBe(true);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const final = record.lastFullStatus!;
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/tool-error.status.json");
  });
});
