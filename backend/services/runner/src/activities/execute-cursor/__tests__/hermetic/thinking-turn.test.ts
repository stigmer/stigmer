/**
 * Hermetic golden: a turn with MODEL THINKING on both sides of a tool call,
 * through the whole `ExecuteCursor` activity.
 *
 * Invariant pinned (the rule the canonical builder had to reproduce when it
 * took over in #1097): the Cursor SDK has ONE `run_id` per `send()`, so the transcript's
 * segmentation is not by run but by tool call — a `tool_call` event closes the
 * run's streaming AI and THINKING rows (the translator's `message_finish` for
 * the open segment; until #1097 the accumulator's own finalize on a tool call),
 * and the thinking or text that follows opens NEW rows. Hence the shape:
 * THINKING(T1), AI(A1 + the read row), THINKING(T2), AI(A2). The read row lands
 * on A1 (the last AI message by backward scan; a THINKING row is skipped), and
 * no row is left `isStreaming` when the turn ends.
 *
 * Predicted for the swap to the shared builder (2026-09-14): NO move.
 * The builder keeps one THINKING row per segment on Cursor (the translator
 * mints a segment id per text-or-thinking run between tool calls) and keeps
 * the tool on the message that proposed it. A diff in this golden is a
 * pause, not a regeneration.
 *
 * Why this net exists: none of the seventeen earlier Cursor goldens carried
 * a THINKING row, and the thinking rule is one #1097 rewrote.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-cursor/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase, MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

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

const AGENT_ID = "agent-hermetic-thinking-0001";
const RUN_ID = "run-hermetic-thinking-0001";
const CALL_ID = "call-hermetic-thinking-read-0001";
const USER_MESSAGE = "Summarise README.md.";
const THINKING_BEFORE = "The user wants a summary; I should read the file first.";
const TEXT_BEFORE = "Reading the file.";
const READ_ARGS = { path: "README.md" };
const READ_RESULT = "# Hermetic\n\nA fixture readme.\n";
const THINKING_AFTER = "One line of content; a one-sentence summary will do.";
const TEXT_AFTER = "README.md is a one-line fixture description.";

describe("ExecuteCursor hermetic — thinking on both sides of a tool call", () => {
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

  it("folds into THINKING, AI+row, THINKING, AI with nothing left streaming and completes", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const ev = sdkEvents(AGENT_ID, RUN_ID);
    const agent = new ScriptedCursorAgent({
      agentId: AGENT_ID,
      runIds: [RUN_ID],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev.init()),
          step.event(ev.thinking(THINKING_BEFORE)),
          step.event(ev.assistant(TEXT_BEFORE)),
          step.event(ev.toolCall(CALL_ID, "read", "running", READ_ARGS)),
          step.event(ev.toolCall(CALL_ID, "read", "completed", READ_ARGS, READ_RESULT)),
          step.event(ev.thinking(THINKING_AFTER)),
          step.event(ev.assistant(TEXT_AFTER)),
          step.turnEnded({ inputTokens: 2_400, outputTokens: 140, cacheReadTokens: 0, cacheWriteTokens: 0 }),
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

    // ── Assert: outcome ──────────────────────────────────────────────────────
    expect(invocation.outcome.kind).toBe("returned");
    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("EXECUTION_COMPLETED");
    expect(record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_COMPLETED);

    // ── Assert: the segmentation ─────────────────────────────────────────────
    const final = record.lastFullStatus!;
    expect(
      final.messages.map((m) => [m.type, m.content]),
      "a tool call closes the run's THINKING and AI rows; what follows opens new ones",
    ).toEqual([
      [MessageType.MESSAGE_THINKING, THINKING_BEFORE],
      [MessageType.MESSAGE_AI, TEXT_BEFORE],
      [MessageType.MESSAGE_THINKING, THINKING_AFTER],
      [MessageType.MESSAGE_AI, TEXT_AFTER],
    ]);
    expect(final.messages.every((m) => !m.isStreaming), "finalize clears every streaming flag").toBe(true);

    // ── Assert: the row sits on the text that proposed it ────────────────────
    const rows = record.toolCalls();
    expect(rows.map((tc) => [tc.id, tc.status])).toEqual([[CALL_ID, ToolCallStatus.TOOL_CALL_COMPLETED]]);
    expect(final.messages[1].toolCalls.map((tc) => tc.id), "the read row is on AI(A1), not on a THINKING row").toEqual([CALL_ID]);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/thinking-turn.status.json");
  });
});
