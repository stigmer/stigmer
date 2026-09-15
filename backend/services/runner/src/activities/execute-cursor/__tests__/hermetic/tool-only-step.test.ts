/**
 * Hermetic golden: a turn whose FIRST event after `init` is a tool call — no
 * assistant text proposed it — through the whole `ExecuteCursor` activity.
 *
 * Invariant pinned (S4 M0 net): a tool call with no AI message before it in
 * its scope gets an EMPTY AI message created to carry its row
 * (the builder's AI-message boundary, Q-S4-5), and the assistant text
 * that follows the tool opens a new message. So: AI(`""` + the read row),
 * AI(A1). This is the same shape the native builder produces for a model turn
 * that proposes tools without text (`ensureAiMessageForToolCall`), which is
 * why the canonical builder can serve both.
 *
 * Predicted under the S4 rulings (`T01_1_review.md`, 2026-09-14): NO move.
 * Q-S4-5's rule ("the scope's current AI message, lazily created empty when
 * the scope's latest model run had no text") produces exactly this transcript.
 *
 * Why this net exists: `tool-call.status.json` pins text→tool→text; nothing
 * pinned a tool with no proposing text before M0.
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

const AGENT_ID = "agent-hermetic-toolonly-0001";
const RUN_ID = "run-hermetic-toolonly-0001";
const CALL_ID = "call-hermetic-toolonly-read-0001";
const USER_MESSAGE = "What is in README.md?";
const READ_ARGS = { path: "README.md" };
const READ_RESULT = "# Hermetic\n\nA fixture readme.\n";
const ASSISTANT_TEXT = "README.md holds a one-line fixture description.";

describe("ExecuteCursor hermetic — a tool call with no proposing text", () => {
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

  it("creates an empty AI message for the row and a new one for the text that follows", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const ev = sdkEvents(AGENT_ID, RUN_ID);
    const agent = new ScriptedCursorAgent({
      agentId: AGENT_ID,
      runIds: [RUN_ID],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev.init()),
          step.event(ev.toolCall(CALL_ID, "read", "running", READ_ARGS)),
          step.event(ev.toolCall(CALL_ID, "read", "completed", READ_ARGS, READ_RESULT)),
          step.event(ev.assistant(ASSISTANT_TEXT)),
          step.turnEnded({ inputTokens: 1_800, outputTokens: 60, cacheReadTokens: 0, cacheWriteTokens: 0 }),
          step.finished({ result: ASSISTANT_TEXT, model: { id: FIXTURE.model, params: [] } }),
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

    // ── Assert: the transcript ───────────────────────────────────────────────
    const final = record.lastFullStatus!;
    expect(
      final.messages.map((m) => [m.type, m.content, m.toolCalls.map((tc) => tc.id)]),
      "an empty AI message carries the row; the text after the tool is a new message",
    ).toEqual([
      [MessageType.MESSAGE_AI, "", [CALL_ID]],
      [MessageType.MESSAGE_AI, ASSISTANT_TEXT, []],
    ]);
    const row = record.toolCalls()[0];
    expect(row.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(row.result).toBe(READ_RESULT);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/tool-only-step.status.json");
  });
});
