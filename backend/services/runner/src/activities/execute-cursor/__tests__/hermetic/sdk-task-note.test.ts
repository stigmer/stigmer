/**
 * Hermetic golden: the SDK's `task` event — a status line about the run in
 * the agent's own voice — between two assistant messages, through the whole
 * `ExecuteCursor` activity.
 *
 * Invariant pinned (S4 M4 C1, Q-M4-4; S4 review finding 9 — this event had
 * no test on either tier): a `task` event with text becomes ONE SYSTEM
 * message at its position in the transcript (`translateTask`); it hosts no
 * tool rows and does not move the AI-message boundary — the tool call that
 * follows it lands on the assistant message BEFORE the note, and the text
 * after the tool call is a new message. A `task` event with no text produces
 * nothing.
 *
 * Predicted under the S4 rulings: NO move at the swap (B4). The translator
 * maps `task.text` to the union's `system_note` (Q-S4-18), which the builder
 * appends as a SYSTEM message in the scope with the same placement rule.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-cursor/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase, MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

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

const AGENT_ID = "agent-hermetic-tasknote-0001";
const RUN_ID = "run-hermetic-tasknote-0001";
const CALL_ID = "call-hermetic-tasknote-read-0001";
const USER_MESSAGE = "Summarise README.md.";
const TEXT_BEFORE = "Reading the file first.";
const TASK_NOTE = "Scanning the workspace for the file.";
const READ_ARGS = { path: "README.md" };
const READ_RESULT = "# Hermetic\n\nA fixture readme.\n";
const TEXT_AFTER = "README.md is a one-line fixture description.";

describe("ExecuteCursor hermetic — the SDK's task event as a system note", () => {
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

  it("places the note as a SYSTEM message that hosts no rows and moves no boundary; an empty note produces nothing", async () => {
    const ev = sdkEvents(AGENT_ID, RUN_ID);
    const agent = new ScriptedCursorAgent({
      agentId: AGENT_ID,
      runIds: [RUN_ID],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev.init()),
          step.event(ev.assistant(TEXT_BEFORE)),
          step.event(ev.task(TASK_NOTE, "running")),
          step.event(ev.task("", "running")),
          step.event(ev.toolCall(CALL_ID, "read", "running", READ_ARGS)),
          step.event(ev.toolCall(CALL_ID, "read", "completed", READ_ARGS, READ_RESULT)),
          step.event(ev.assistant(TEXT_AFTER)),
          step.turnEnded({ inputTokens: 1_800, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0 }),
          step.finished({ result: TEXT_AFTER, model: { id: FIXTURE.model, params: [] } }),
        ],
      ],
    });
    const record = cursorExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [agent], catalog: SDK_CATALOG } });

    const invocation = await runCursorTurn(scenario);

    expect(invocation.outcome.kind).toBe("returned");
    expect(record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_COMPLETED);

    const messages = record.lastFullStatus!.messages;
    expect(messages.map((m) => m.type), "AI, the note, AI").toEqual([
      MessageType.MESSAGE_AI,
      MessageType.MESSAGE_SYSTEM,
      MessageType.MESSAGE_AI,
    ]);
    expect(messages[1].content).toBe(TASK_NOTE);
    expect(messages[1].toolCalls, "a note hosts no rows").toHaveLength(0);
    expect(messages[0].toolCalls.map((tc) => tc.id), "the row lands on the assistant message before the note").toEqual([CALL_ID]);
    expect(messages[2].content).toBe(TEXT_AFTER);
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, record.lastFullStatus!), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/sdk-task-note.status.json");
  });
});
