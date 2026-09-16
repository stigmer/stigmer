/**
 * Hermetic golden: the agent's TO-DO LIST on the native harness — the model
 * proposes deepagents' built-in `write_todos`, the tools node runs it for
 * real, and the builder projects the list into `status.todos`.
 *
 * Invariant pinned: `TranscriptBuilder.handleToolStarted` classifies
 * the row `ToolKind.TODO` by name; `handleToolFinished` projects `tc.args.todos`
 * into `status.todos` through the shared `applyTodoUpdate` as a FULL REPLACE
 * (deepagents' schema has no `merge`), keyed `todo-<i>`, and KEEPS the row in
 * the transcript — the clients filter `ToolKind.TODO` from the thread. As an
 * ungated built-in it carries `argsPreview` like every row since #1097
 * (until then native stamped a preview on gated rows only).
 *
 * What the golden shows:
 *  - The row sits on the AI message whose text proposed it, "Planning the two
 *    steps." (since #1097; until then on an empty message between the two
 *    texts — see `tool-call.test.ts`'s header).
 *  - The row's `result` is the tool's confirmation text, "Updated todo list
 *    to [...]" (since #1097). deepagents' `write_todos` returns a
 *    LangGraph `Command` (`{ lg_name: "Command", update: { todos, messages:
 *    [ToolMessage] } }`); until then the native extractor unwrapped a
 *    LangChain `ToolMessage` envelope but not a `Command`, so the row carried
 *    the whole serialized Command — the todos array a second time and the
 *    text nested inside it (pinned as found when this net opened,
 *    regenerated in #1097 with that one hunk).
 *
 * The #1097 moves, as landed (2026-09-14): the
 * row joined `messages[0]` ("Planning the two steps.") and the empty message
 * went; the row gained `argsPreview`, the elided preview of
 * its `args`. `todos` is byte-identical (the builder keeps native's
 * full-replace: `write_todos` never sends `merge`). Any other hunk is a pause.
 *
 * Why this net exists: none of the twenty-three earlier native goldens
 * carried a todo, and #1097 moved the projection from the native builder
 * into the canonical one.
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
    expect(JSON.parse(row.argsPreview), "every row carries its elided preview").toEqual({ todos: TODOS });
    expect(row.requiresApproval).toBe(false);
    // Since #1097: the ToolMessage's content, never the serialized Command.
    expect(row.result.startsWith("Updated todo list to"), "the tool's own confirmation text is what the row carries").toBe(true);
    expect(row.result).not.toContain("lg_name");

    // ── Assert: the transcript — the row beside the text that proposed it ──
    const final = record.lastFullStatus!;
    const ai = final.messages.filter((m) => m.type === MessageType.MESSAGE_AI);
    expect(ai.map((m) => [m.content, m.toolCalls.map((tc) => tc.id)])).toEqual([
      [TEXT_PLAN, [CALL_ID]],
      [TEXT_CLOSING, []],
    ]);

    // ── Assert: the projection, by key (byte-identical across the swap) ─────
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
