/**
 * Hermetic golden: the agent's TO-DO LIST — two `updateTodos` tool calls, the
 * second a `merge`, through the whole `ExecuteCursor` activity.
 *
 * Invariant pinned (S4 M0 net; TODAY's shape, which M4 changes on purpose):
 * the Cursor harness has two consumers of a todo tool call, and neither puts a
 * row in the transcript. `TodoTracker` acts on the `completed` event only and
 * projects `args.todos` into `status.todos` through the shared
 * `applyTodoUpdate` — a full replace by default, a MERGE when the SDK's args
 * say `merge: true` (the first write's `createdAt` survives, `updatedAt`
 * moves). `MessageAccumulator` closes the run's streaming text on the call
 * like any tool (`finalizeStreaming` runs before the suppression check) and
 * then DROPS the row (`SUPPRESSED_TOOL_NAMES`). So: three AI messages, no tool
 * rows, two todos.
 *
 * Predicted under the S4 rulings (`T01_1_review.md`, 2026-09-14): TWO hunks at
 * M4, both under Q-S4-7, and nothing else. An `updateTodos` row (COMPLETED,
 * `toolKind` TODO, `args`, `argsPreview`) appears on `messages[0]` and another
 * on `messages[1]` — the canonical builder keeps the row and projects the
 * todos from it, as native already does; the web console hides the row
 * (`isInternalTool`), the CLI TUI shows it as it does for native. `todos` is
 * byte-identical: the builder reads `merge` from the call's args. A diff in
 * `todos` at M4 is a pause.
 *
 * Why this net exists: no Cursor golden before M0 carried a todo, and both
 * `TodoTracker` and the suppression are deleted at M4.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-cursor/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase, MessageType, TodoStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

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

  it("projects a replace then a merge into status.todos and keeps the rows out of the transcript (today)", async () => {
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

    // ── Assert: the transcript, as it is today (the M4 hunks add a row to [0] and [1]) ──
    const final = record.lastFullStatus!;
    expect(
      final.messages.map((m) => [m.type, m.content, m.toolCalls.length]),
      "the todo call splits the text like any tool, and its row is suppressed",
    ).toEqual([
      [MessageType.MESSAGE_AI, TEXT_PLAN, 0],
      [MessageType.MESSAGE_AI, TEXT_WORK, 0],
      [MessageType.MESSAGE_AI, TEXT_CLOSING, 0],
    ]);
    expect(record.toolCalls()).toHaveLength(0);

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
