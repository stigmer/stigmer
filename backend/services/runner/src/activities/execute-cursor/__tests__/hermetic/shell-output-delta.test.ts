/**
 * Hermetic goldens: the SDK's DELTA CHANNEL folding onto a shell tool's row —
 * `tool-call-started`, `shell-output-delta` and `tool-call-completed` fired
 * through `onDelta` between the stream's own `tool_call` events — through the
 * whole `ExecuteCursor` activity.
 *
 * Why this net exists (S4 M4 C1, Q-M4-4): the scripted double emitted only the
 * `turn-ended` usage delta until this milestone, so the rule M4 changes most —
 * a completion learned from the timing delta and merged with the stream's
 * later completion (Q-S4-3(c)) — had no end-to-end net; `delta-enricher.ts`'s
 * twelve unit arms were the whole of it. The three arms below pin TODAY's
 * shape, as the enricher folds it, and each header states what the rulings
 * predict will move at the swap (B4) and after it (B5).
 *
 * Arm 1 — the ordinary order. The stream's `running` creates the row; the
 * deltas arrive; the stream's `completed` settles it. Pinned: `startedAt` is
 * the stream's `running` instant; the live output reaches `result`
 * (`streamingSource: OUTPUT` while it streams, cleared at finalize); the
 * stream's `completed` stamps `completedAt` and its result wins; the shell
 * row is a gated built-in (`requiresApproval`, "Run command: …") that the
 * hook never saw, so no `approvalRequestedAt`. Predicted: NO move at B4 or
 * B5 (the translator drains the queued deltas AFTER the stream event of the
 * same window, as the enricher applied them, so the stream's instant wins
 * exactly as today).
 *
 * Arm 2 — output BEFORE the row exists. A `shell-output-delta` fires before
 * the stream's `running` for its call. Pinned: nothing is lost — the enricher
 * buffers the chunk and applies it once the row exists, so the final `result`
 * carries both chunks in order. Predicted: NO move at B4 (the translator holds
 * a delta for a call the stream has not announced and replays it after the
 * `tool_started` that announces it — M4 finding F-M4-7).
 *
 * Arm 3 — the completion delta reports an ERROR, and a model event sits
 * between it and the stream's own `error`. Pinned AS FOUND (M4 finding
 * F-M4-5): the enricher promotes the row RUNNING → COMPLETED at the next
 * stream event because a completion delta arrived, and the monotonic merge
 * then refuses the stream's FAILED — the row ends COMPLETED carrying an
 * `error`, a row that lies. `completedAt` is the delta's own instant (the
 * enricher captured it at delta time and applied it later). Predicted: NO
 * move at B4 (the translator reproduces the fold, instant included); at B5
 * (Q-M4-5) the translator honours `result.status: "error"` and the row ends
 * FAILED, with `approvalRequestedAt` at the instant the failure was observed.
 * Moved at A4 (Q-M4-3) by one line this header had not named when C1 wrote
 * it (M4 finding F-M4-32): the stream's `error` merge had duplicated the
 * failure text into `result`; a failure's text is its `error` alone.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-cursor/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import type { InteractionUpdate } from "@cursor/sdk";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

vi.mock("@cursor/sdk", async () =>
  (await import("../../__test-utils__/scripted-sdk.js")).scriptedCursorSdkModule(),
);
vi.mock("@cursor/sdk/sqlite", async () =>
  (await import("../../__test-utils__/scripted-sdk.js")).scriptedCursorSqliteModule(),
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

const USER_MESSAGE = "Run the test suite.";
const COMMAND = "npm test";
const SHELL_ARGS = { command: COMMAND };
const CHUNK_1 = "> test\n";
const CHUNK_2 = "12 passing\n";
const FULL_OUTPUT = CHUNK_1 + CHUNK_2;

/**
 * The delta channel's shapes, typed against the SDK so a drift fails `tsc`
 * (the stigmer#1053 dividend — writing these is how the runner learned the
 * timing deltas carry `modelCallId`, the LLM call that issued the tool; M4
 * finding F-M4-31, recorded for S5, unread here).
 */
const MODEL_CALL_ID = "model-call-hermetic-shelldelta";
const deltas = {
  started(callId: string): InteractionUpdate {
    return { type: "tool-call-started", callId, modelCallId: MODEL_CALL_ID, toolCall: { type: "shell", args: SHELL_ARGS } };
  },
  output(callId: string, data: string): InteractionUpdate {
    return { type: "shell-output-delta", event: { callId, type: "stdout", data } };
  },
  completedOk(callId: string, stdout: string): InteractionUpdate {
    return {
      type: "tool-call-completed",
      callId,
      modelCallId: MODEL_CALL_ID,
      toolCall: {
        type: "shell",
        args: SHELL_ARGS,
        result: { status: "success", value: { exitCode: 0, signal: "", stdout, stderr: "", executionTime: 1_200 } },
      },
    };
  },
  completedError(callId: string, error: string): InteractionUpdate {
    return {
      type: "tool-call-completed",
      callId,
      modelCallId: MODEL_CALL_ID,
      toolCall: { type: "shell", args: SHELL_ARGS, result: { status: "error", error } },
    };
  },
};

describe("ExecuteCursor hermetic — the delta channel on a shell row", () => {
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

  it("arm 1: started, output and completed deltas between the stream's running and completed fold onto one row", async () => {
    const AGENT_ID = "agent-hermetic-shelldelta-0001";
    const RUN_ID = "run-hermetic-shelldelta-0001";
    const CALL_ID = "call-hermetic-shelldelta-0001";
    const TEXT_AFTER = "All 12 tests pass.";
    const ev = sdkEvents(AGENT_ID, RUN_ID);
    const agent = new ScriptedCursorAgent({
      agentId: AGENT_ID,
      runIds: [RUN_ID],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev.init()),
          step.event(ev.assistant("Running the tests.")),
          step.event(ev.toolCall(CALL_ID, "shell", "running", SHELL_ARGS)),
          step.delta(deltas.started(CALL_ID)),
          step.delta(deltas.output(CALL_ID, CHUNK_1)),
          step.delta(deltas.output(CALL_ID, CHUNK_2)),
          step.delta(deltas.completedOk(CALL_ID, FULL_OUTPUT)),
          step.event(ev.toolCall(CALL_ID, "shell", "completed", SHELL_ARGS, FULL_OUTPUT)),
          step.event(ev.assistant(TEXT_AFTER)),
          step.turnEnded({ inputTokens: 2_000, outputTokens: 60, cacheReadTokens: 0, cacheWriteTokens: 0 }),
          step.finished({ result: TEXT_AFTER, model: { id: FIXTURE.model, params: [] } }),
        ],
      ],
    });
    const record = cursorExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [agent], catalog: SDK_CATALOG } });

    const invocation = await runCursorTurn(scenario);

    expect(invocation.outcome.kind).toBe("returned");
    expect(record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    const rows = record.toolCalls();
    expect(rows, "the stream's two events and the four deltas fold into ONE row").toHaveLength(1);
    const row = rows[0];
    expect(row.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(row.result, "the live output reached the row").toBe(FULL_OUTPUT);
    expect(row.isStreaming, "finalize closed the OUTPUT stream").toBe(false);
    expect(row.startedAt < row.completedAt).toBe(true);
    expect(row.requiresApproval, "a shell is a gated built-in the hook never saw").toBe(true);
    expect(row.approvalRequestedAt).toBe("");
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, record.lastFullStatus!), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/shell-output-delta.status.json");
  });

  it("arm 2: an output delta that precedes the stream's running is held and lands once the row exists", async () => {
    const AGENT_ID = "agent-hermetic-shelldelta-0002";
    const RUN_ID = "run-hermetic-shelldelta-0002";
    const CALL_ID = "call-hermetic-shelldelta-0002";
    const TEXT_AFTER = "Done; the suite is green.";
    const ev = sdkEvents(AGENT_ID, RUN_ID);
    const agent = new ScriptedCursorAgent({
      agentId: AGENT_ID,
      runIds: [RUN_ID],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev.init()),
          step.event(ev.assistant("Running the tests.")),
          step.delta(deltas.started(CALL_ID)),
          step.delta(deltas.output(CALL_ID, CHUNK_1)),
          step.event(ev.toolCall(CALL_ID, "shell", "running", SHELL_ARGS)),
          step.delta(deltas.output(CALL_ID, CHUNK_2)),
          step.delta(deltas.completedOk(CALL_ID, FULL_OUTPUT)),
          step.event(ev.toolCall(CALL_ID, "shell", "completed", SHELL_ARGS, FULL_OUTPUT)),
          step.event(ev.assistant(TEXT_AFTER)),
          step.turnEnded({ inputTokens: 2_000, outputTokens: 60, cacheReadTokens: 0, cacheWriteTokens: 0 }),
          step.finished({ result: TEXT_AFTER, model: { id: FIXTURE.model, params: [] } }),
        ],
      ],
    });
    const record = cursorExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [agent], catalog: SDK_CATALOG } });

    await runCursorTurn(scenario);

    expect(record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    const rows = record.toolCalls();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(rows[0].result, "the early chunk was not lost").toBe(FULL_OUTPUT);

    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, record.lastFullStatus!), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/shell-output-delta.output-first.status.json");
  });

  it("arm 3: an error-status completion delta, with a model event before the stream's error, is folded as the enricher folds it today", async () => {
    const AGENT_ID = "agent-hermetic-shelldelta-0003";
    const RUN_ID = "run-hermetic-shelldelta-0003";
    const CALL_ID = "call-hermetic-shelldelta-0003";
    const SHELL_ERROR = "sh: npm: command not found";
    const TEXT_AFTER = "npm is not installed here.";
    const ev = sdkEvents(AGENT_ID, RUN_ID);
    const agent = new ScriptedCursorAgent({
      agentId: AGENT_ID,
      runIds: [RUN_ID],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev.init()),
          step.event(ev.assistant("Running the tests.")),
          step.event(ev.toolCall(CALL_ID, "shell", "running", SHELL_ARGS)),
          step.delta(deltas.started(CALL_ID)),
          step.delta(deltas.completedError(CALL_ID, SHELL_ERROR)),
          // The model reacts before the stream reports the tool's own outcome —
          // the interleaving that lets a completion delta settle the row first.
          step.event(ev.thinking("The command failed; npm may be missing.")),
          step.event(ev.toolCall(CALL_ID, "shell", "error", SHELL_ARGS, SHELL_ERROR)),
          step.event(ev.assistant(TEXT_AFTER)),
          step.turnEnded({ inputTokens: 2_000, outputTokens: 80, cacheReadTokens: 0, cacheWriteTokens: 0 }),
          step.finished({ result: TEXT_AFTER, model: { id: FIXTURE.model, params: [] } }),
        ],
      ],
    });
    const record = cursorExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [agent], catalog: SDK_CATALOG } });

    await runCursorTurn(scenario);

    expect(record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    const rows = record.toolCalls();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    // As found (F-M4-5): the enricher's promotion won the race and the monotonic
    // merge kept it, so the row says COMPLETED while carrying the failure.
    expect(row.status, "pinned as found; Q-M4-5 moves this to FAILED at B5").toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(row.error).toBe(SHELL_ERROR);

    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, record.lastFullStatus!), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/shell-output-delta.error-delta.status.json");
  });
});
