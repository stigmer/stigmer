/**
 * Hermetic golden: the agent's TO-DO LIST on the native harness — the model
 * proposes deepagents' built-in `write_todos`, the tools node runs it for
 * real, and the builder projects the list into `status.todos`.
 *
 * Invariant pinned (S4 M0 net): `TranscriptBuilder.handleToolStarted` classifies
 * the row `ToolKind.TODO` by name; `handleToolFinished` projects `tc.args.todos`
 * into `status.todos` through the shared `applyTodoUpdate` as a FULL REPLACE
 * (deepagents' schema has no `merge`), keyed `todo-<i>`, and KEEPS the row in
 * the transcript — the clients filter `ToolKind.TODO` from the thread. As an
 * ungated built-in it carries no `argsPreview` today (native stamps a preview
 * on gated rows only).
 *
 * What the golden shows about TODAY's shape, recorded as found:
 *  - The row sits on an EMPTY AI message between the proposing text and the
 *    closing text (F-M0-1, the `model_request:`/`tools:` namespace miss; see
 *    `tool-call.test.ts`'s header).
 *  - The row's `result` is NOT the tool's confirmation text. deepagents'
 *    `write_todos` returns a LangGraph `Command` (`{ lg_name: "Command",
 *    update: { todos, messages: [ToolMessage] } }`), and `extractToolResultV3`
 *    unwraps a LangChain `ToolMessage` envelope but not a `Command`, so the
 *    row carries the whole serialized Command — the todos array a second time
 *    and the "Updated todo list to [...]" text nested inside it (S4 M0 finding
 *    F-M0-2). The web console never shows it (the row is filtered); the CLI TUI
 *    does. The unwrapping is the native translator's to fix, where
 *    `extractToolResultV3` moves at M2 (Q-S4-3); whether it does is the
 *    owner's ruling, not this test's.
 *
 * Predicted under the S4 rulings (`T01_1_review.md`, 2026-09-14): TWO hunks
 * at M2, and nothing else unless F-M0-2 is ruled. Under Q-S4-5 the row joins
 * `messages[0]` ("Planning the two steps.") and the empty message goes; under
 * Q-S4-16 the row gains `argsPreview` (the elided preview of its `args`).
 * `todos` is byte-identical (Q-S4-7 keeps native's full-replace: `write_todos`
 * never sends `merge`). If F-M0-2 is ruled an alignment, a third hunk makes
 * `result` the ToolMessage's content; any other hunk is a pause.
 *
 * Why this net exists: none of the twenty-three native goldens before M0
 * carried a todo; the projection moves from the native builder into the
 * canonical one at M1 and is re-keyed at M2.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-deep-agent/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ExecutionPhase,
  MessageType,
  TodoStatus,
  ToolCallStatus,
  ToolKind,
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

const CALL_ID = "call-hermetic-todos-0001";
const USER_MESSAGE = "Plan the two steps.";
const TEXT_PLAN = "Planning the two steps.";
/** deepagents' `write_todos` schema: `{ content, status }` per item, three statuses, no id, no merge. */
const TODOS = [
  { content: "Read the fixture", status: "pending" },
  { content: "Summarise it", status: "in_progress" },
];
const TEXT_CLOSING = "The plan is written.";

describe("ExecuteDeepAgent hermetic — write_todos", () => {
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

  it("projects the completed write into status.todos, keeps the row, and completes", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const record = deepAgentExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => ({
        turns: [
          {
            text: TEXT_PLAN,
            toolCalls: [{ id: CALL_ID, name: "write_todos", args: { todos: TODOS } }],
            usage: { inputTokens: 1_400, outputTokens: 70 },
          },
          { text: TEXT_CLOSING, usage: { inputTokens: 1_600, outputTokens: 20 } },
        ],
      }),
    });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runDeepAgentTurn(scenario);

    // ── Assert: outcome ──────────────────────────────────────────────────────
    expect(invocation.outcome.kind).toBe("returned");
    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("EXECUTION_COMPLETED");
    expect(record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_COMPLETED);

    // ── Assert: the row stays in the transcript, classified TODO ─────────────
    const rows = record.toolCalls();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.id).toBe(CALL_ID);
    expect(row.name).toBe("write_todos");
    expect(row.toolKind).toBe(ToolKind.TODO);
    expect(row.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(row.args).toEqual({ todos: TODOS });
    expect(row.argsPreview, "TODAY: an ungated native row carries no preview (the M2 hunk, Q-S4-16, adds one)").toBe("");
    expect(row.requiresApproval).toBe(false);
    // F-M0-2, as found: the serialized Command, not the ToolMessage's content.
    expect(row.result.startsWith('{"lg_name":"Command"'), "the Command envelope is what the row carries today").toBe(true);
    expect(row.result).toContain("Updated todo list to");

    // ── Assert: the transcript, as it is today (F-M0-1; the M2 hunk, Q-S4-5) ─
    const final = record.lastFullStatus!;
    const ai = final.messages.filter((m) => m.type === MessageType.MESSAGE_AI);
    expect(ai.map((m) => [m.content, m.toolCalls.map((tc) => tc.id)])).toEqual([
      [TEXT_PLAN, []],
      ["", [CALL_ID]],
      [TEXT_CLOSING, []],
    ]);

    // ── Assert: the projection, by key (Q-S4-7 keeps this byte-identical) ────
    expect(Object.keys(final.todos).sort()).toEqual(["todo-0", "todo-1"]);
    expect([final.todos["todo-0"].content, final.todos["todo-0"].status]).toEqual(["Read the fixture", TodoStatus.TODO_PENDING]);
    expect([final.todos["todo-1"].content, final.todos["todo-1"].status]).toEqual(["Summarise it", TodoStatus.TODO_IN_PROGRESS]);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/write-todos.status.json");
  });
});
