/**
 * Hermetic golden: SUB-AGENT DELEGATION on the Cursor harness — the root agent
 * hands work to a sub-agent through the SDK's `task` tool, and the sub-agent's
 * own conversation arrives, whole, in the `task` call's result.
 *
 * Invariant pinned (S4 M0 net): `turn-stream.ts` routes every `tool_call`
 * named `task` to `MessageAccumulator.trackSubAgentExecution` as well as to the
 * root transcript. The `running` event opens a `SubAgentExecution` keyed by the
 * task call id (`name` from `subagentType`, `subject` from `description`,
 * `input` from `prompt`, IN_PROGRESS); the `completed` event closes it
 * COMPLETED with `output` (the stringified result) and rebuilds its transcript
 * from the result's `conversationSteps` (`extractConversationSteps`): an
 * `assistantMessage` step is an AI row, and a `toolCall` step is a tool row on
 * the transcript's LAST AI message — the assistant step that proposed it — named
 * from its `<kind>ToolCall` key (`buildSubAgentToolCall`), with the SDK's
 * `toolCallId` as its id, its status from the `result` oneof, both timestamps,
 * `args` and `argsPreview`; a tool step with no assistant step before it gets
 * an empty AI message of its own, the root transcript's rule. The root
 * transcript carries the `task` row itself (COMPLETED, `result` = the same
 * stringified object) on the message that proposed it. This is Cursor's
 * timing — the sub-agent's rows exist only at completion — and stays Cursor's
 * (Q-S4-4).
 *
 * Moved 2026-09-14 (S4 M4 A5, Q-S4-5), the ONE hunk this golden was
 * predicted to take: the sub-agent's `read` row sits on the AI message of the
 * assistant step that precedes it (`messages[0]`, "Looking at README.md."),
 * and the `content: ""` message that carried it until A5 (`messages[1]`) is
 * gone — the canonical builder attaches a tool row to its scope's current AI
 * message, the shape native's sub-agent transcripts took at M2 (F-M0-1), and
 * A5 aligned `extractConversationSteps` before the swap so the swap moves
 * nothing.
 *
 * On the record as found (S5's, not S4's): the `task` row's `result` and the
 * sub-agent's `output` are two copies of one stringified object.
 *
 * Why this net exists: none of the seventeen Cursor goldens before M0 carried
 * a sub-agent row; the transcript-rebuild is deleted whole at M4.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-cursor/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ExecutionPhase,
  MessageType,
  SubAgentStatus,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

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

const AGENT_ID = "agent-hermetic-subagent-0001";
const RUN_ID = "run-hermetic-subagent-0001";
const TASK_CALL_ID = "call-hermetic-task-0001";
const SUB_READ_CALL_ID = "call-hermetic-sub-read-0001";
const USER_MESSAGE = "Ask the helper what README.md says.";
const ROOT_OPENING = "Delegating to the helper.";
const TASK_ARGS = {
  subagentType: "helper",
  description: "Read README.md and report its content.",
  prompt: "Read README.md and reply with its content in one line.",
};
const HELPER_OPENING = "Looking at README.md.";
const HELPER_READ_ARGS = { path: "README.md" };
const HELPER_READ_RESULT = "# Hermetic\n\nA fixture readme.\n";
const HELPER_ANSWER = "README.md is a one-line fixture description.";
/** The SDK's task result: the sub-agent's conversation as protobuf-oneof JSON steps. */
const TASK_RESULT = {
  conversationSteps: [
    { type: "assistantMessage", message: { text: HELPER_OPENING } },
    {
      toolCall: {
        toolCallId: SUB_READ_CALL_ID,
        readToolCall: { args: HELPER_READ_ARGS, result: { success: { content: HELPER_READ_RESULT } } },
      },
    },
    { type: "assistantMessage", message: { text: HELPER_ANSWER } },
  ],
};
const ROOT_CLOSING = "The helper reports: README.md is a one-line fixture description.";

describe("ExecuteCursor hermetic — sub-agent delegation", () => {
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

  it("tracks the task as a SubAgentExecution keyed by the call id and rebuilds its transcript at completion", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const ev = sdkEvents(AGENT_ID, RUN_ID);
    const agent = new ScriptedCursorAgent({
      agentId: AGENT_ID,
      runIds: [RUN_ID],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev.init()),
          step.event(ev.assistant(ROOT_OPENING)),
          step.event(ev.toolCall(TASK_CALL_ID, "task", "running", TASK_ARGS)),
          step.event(ev.toolCall(TASK_CALL_ID, "task", "completed", TASK_ARGS, TASK_RESULT)),
          step.event(ev.assistant(ROOT_CLOSING)),
          step.turnEnded({ inputTokens: 3_900, outputTokens: 102, cacheReadTokens: 0, cacheWriteTokens: 0 }),
          step.finished({ result: ROOT_CLOSING, model: { id: FIXTURE.model, params: [] } }),
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

    // ── Assert: the root transcript ──────────────────────────────────────────
    const final = record.lastFullStatus!;
    expect(record.toolCalls().map((tc) => [tc.id, tc.name, tc.status])).toEqual([
      [TASK_CALL_ID, "task", ToolCallStatus.TOOL_CALL_COMPLETED],
    ]);
    expect(final.messages.map((m) => [m.type, m.content, m.toolCalls.map((tc) => tc.id)])).toEqual([
      [MessageType.MESSAGE_AI, ROOT_OPENING, [TASK_CALL_ID]],
      [MessageType.MESSAGE_AI, ROOT_CLOSING, []],
    ]);

    // ── Assert: the sub-agent execution ──────────────────────────────────────
    expect(final.subAgentExecutions).toHaveLength(1);
    const sub = final.subAgentExecutions[0];
    expect(sub.id, "keyed by the task call id").toBe(TASK_CALL_ID);
    expect(sub.name).toBe("helper");
    expect(sub.subject).toBe(TASK_ARGS.description);
    expect(sub.input).toBe(TASK_ARGS.prompt);
    expect(sub.status).toBe(SubAgentStatus.SUB_AGENT_COMPLETED);
    expect(sub.startedAt < sub.completedAt).toBe(true);
    expect(sub.output, "the stringified task result").toBe(JSON.stringify(TASK_RESULT));

    // The rebuilt transcript: the tool step joins the assistant step that
    // proposed it (Q-S4-5), the root transcript's own boundary rule.
    expect(sub.messages.map((m) => [m.type, m.content, m.toolCalls.map((tc) => tc.id)])).toEqual([
      [MessageType.MESSAGE_AI, HELPER_OPENING, [SUB_READ_CALL_ID]],
      [MessageType.MESSAGE_AI, HELPER_ANSWER, []],
    ]);
    const subRead = sub.messages[0].toolCalls[0];
    expect(subRead.name, "the bare tool name from the readToolCall key").toBe("read");
    expect(subRead.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(subRead.args).toEqual(HELPER_READ_ARGS);
    expect(subRead.result).toBe(JSON.stringify({ content: HELPER_READ_RESULT }));

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/sub-agent-delegation.status.json");
  });
});
