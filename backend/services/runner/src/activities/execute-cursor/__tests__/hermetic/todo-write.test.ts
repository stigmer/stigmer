/**
 * Hermetic golden: the agent's TO-DO LIST — two `updateTodos` tool calls, the
 * second a `merge`, through the whole `ExecuteCursor` activity.
 *
 * Invariant pinned: a todo tool call is a row like any other AND a projection.
 * `TodoTracker` acts on the `completed` event and projects `args.todos` into
 * `status.todos` through the shared `applyTodoUpdate` — a full replace by
 * default, a MERGE when the SDK's args say `merge: true` (the first write's
 * `createdAt` survives, `updatedAt` moves). The accumulator closes the run's
 * streaming text on the call like any tool and keeps the row: an `updateTodos`
 * row (COMPLETED, `toolKind` TODO, `args`, `argsPreview`, `result`) on
 * `messages[0]` and another on `messages[1]`. So: three AI messages, two
 * rows, two todos. The web console hides the row (`isInternalTool`); the CLI
 * TUI shows it, as it does for native.
 *
 * Moved 2026-09-14 (S4 M4 A1, Q-S4-7), the TWO hunks this golden was
 * predicted to take: until A1 `MessageAccumulator` DROPPED the row
 * (`SUPPRESSED_TOOL_NAMES`) and the transcript showed three AI messages with
 * no rows — a per-harness branch on a tool name the canonical builder does
 * not have (native has always kept its `write_todos` row). A1 aligned the
 * accumulator before the swap so the swap moves nothing; `todos` was and is
 * byte-identical. `TodoTracker` itself goes at the swap, where the builder
 * projects the todos from the row.
 *
 * Why this net exists: no Cursor golden before M0 carried a todo.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-cursor/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase, MessageType, TodoStatus, ToolCallStatus, ToolKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

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

const AGENT_ID = "agent-hermetic-todo-0001";
const RUN_ID = "run-hermetic-todo-0001";
const FIRST_CALL_ID = "call-hermetic-todo-0001";
const SECOND_CALL_ID = "call-hermetic-todo-0002";
const USER_MESSAGE = "Plan the two steps, then do the first.";
const TEXT_PLAN = "Two steps; writing them down.";
/** The current SDK's `updateTodos` shape: camelCase statuses, no per-item id. */
const FIRST_WRITE = {
  todos: [
    { content: "Read the fixture", status: "pending" },
    { content: "Summarise it", status: "pending" },
  ],
};
const TEXT_WORK = "First step done.";
const SECOND_WRITE = {
  todos: [{ content: "Read the fixture", status: "completed" }],
  merge: true,
};
const TEXT_CLOSING = "The first step is complete; the second is pending.";

describe("ExecuteCursor hermetic — todo writes", () => {
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

  it("projects a replace then a merge into status.todos and keeps a row per write in the transcript", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const ev = sdkEvents(AGENT_ID, RUN_ID);
    const agent = new ScriptedCursorAgent({
      agentId: AGENT_ID,
      runIds: [RUN_ID],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev.init()),
          step.event(ev.assistant(TEXT_PLAN)),
          step.event(ev.toolCall(FIRST_CALL_ID, "updateTodos", "running", FIRST_WRITE)),
          step.event(ev.toolCall(FIRST_CALL_ID, "updateTodos", "completed", FIRST_WRITE, "ok")),
          step.event(ev.assistant(TEXT_WORK)),
          step.event(ev.toolCall(SECOND_CALL_ID, "updateTodos", "running", SECOND_WRITE)),
          step.event(ev.toolCall(SECOND_CALL_ID, "updateTodos", "completed", SECOND_WRITE, "ok")),
          step.event(ev.assistant(TEXT_CLOSING)),
          step.turnEnded({ inputTokens: 2_600, outputTokens: 160, cacheReadTokens: 0, cacheWriteTokens: 0 }),
          step.finished({ result: TEXT_CLOSING, model: { id: FIXTURE.model, params: [] } }),
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

    // ── Assert: the transcript — a row per write, on the message that proposed it (Q-S4-7) ──
    const final = record.lastFullStatus!;
    expect(
      final.messages.map((m) => [m.type, m.content, m.toolCalls.length]),
      "the todo call splits the text like any tool, and its row stays",
    ).toEqual([
      [MessageType.MESSAGE_AI, TEXT_PLAN, 1],
      [MessageType.MESSAGE_AI, TEXT_WORK, 1],
      [MessageType.MESSAGE_AI, TEXT_CLOSING, 0],
    ]);
    const rows = record.toolCalls();
    expect(rows.map((tc) => [tc.id, tc.toolKind, tc.status])).toEqual([
      [FIRST_CALL_ID, ToolKind.TODO, ToolCallStatus.TOOL_CALL_COMPLETED],
      [SECOND_CALL_ID, ToolKind.TODO, ToolCallStatus.TOOL_CALL_COMPLETED],
    ]);

    // ── Assert: the todos, by key (Q-S4-7 keeps these byte-identical) ────────
    expect(Object.keys(final.todos).sort()).toEqual(["todo-0", "todo-1"]);
    const first = final.todos["todo-0"];
    const second = final.todos["todo-1"];
    expect([first.content, first.status]).toEqual(["Read the fixture", TodoStatus.TODO_COMPLETED]);
    expect(first.createdAt < first.updatedAt, "the merge kept the first write's createdAt and moved updatedAt").toBe(true);
    expect([second.content, second.status]).toEqual(["Summarise it", TodoStatus.TODO_PENDING]);
    expect(second.createdAt, "untouched by the merge").toBe(second.updatedAt);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/todo-write.status.json");
  });
});
