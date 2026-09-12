/**
 * Hermetic golden: a turn with an UNGATED TOOL CALL through the whole
 * `ExecuteCursor` activity.
 *
 * Invariant pinned: a `tool_call` the SDK streams as `running` and then
 * `completed` folds into exactly one `ToolCall` row on the AI message — id from
 * `call_id`, name from the stream taxonomy, `args` + `argsPreview` from the
 * event's args, `result` from the completed event, `startedAt`/`completedAt`
 * from the two events' instants, `toolKind` classified, no approval fields set
 * (a read-only built-in is not gated) — and the turn ends COMPLETED. The golden
 * (`goldens/tool-call.status.json`) is the row shape S4's canonical transcript
 * builder must reproduce byte for byte.
 *
 * Parent phase rows exercised beyond `plain-turn`: run the turn and consume
 * the engine stream (tool-call folding in `message-translator.ts`); the turn
 * boundary with nothing to gate or capture (a read tool writes no file; the
 * per-session workspace is unchanged, so the capture finds no candidate).
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

const AGENT_ID = "agent-hermetic-tool-0001";
const RUN_ID = "run-hermetic-tool-0001";
const CALL_ID = "call-hermetic-read-0001";
const USER_MESSAGE = "What is in README.md?";
const READ_ARGS = { path: "README.md" };
const READ_RESULT = "# Hermetic\n\nA fixture readme.\n";
const ASSISTANT_TEXT = "README.md holds a one-line fixture description.";

describe("ExecuteCursor hermetic — ungated tool call", () => {
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

  it("folds running -> completed into one COMPLETED tool-call row and completes", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const ev = sdkEvents(AGENT_ID, RUN_ID);
    const agent = new ScriptedCursorAgent({
      agentId: AGENT_ID,
      runIds: [RUN_ID],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev.init()),
          step.event(ev.assistant("Let me read it.")),
          step.event(ev.toolCall(CALL_ID, "read", "running", READ_ARGS)),
          step.event(ev.toolCall(CALL_ID, "read", "completed", READ_ARGS, READ_RESULT)),
          step.event(ev.assistant(ASSISTANT_TEXT)),
          step.turnEnded({ inputTokens: 2_000, outputTokens: 90 }),
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

    // ── Assert: outcome and phases ───────────────────────────────────────────
    expect(invocation.outcome.kind).toBe("returned");
    const slim = (invocation.outcome as { value: Record<string, unknown> }).value;
    expect(slim.phase).toBe("EXECUTION_COMPLETED");
    expect(slim.final_text).toBe(ASSISTANT_TEXT);
    expect(record.persistedPhases).toEqual([
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_COMPLETED,
    ]);

    // ── Assert: the one tool-call row ────────────────────────────────────────
    const rows = record.toolCalls();
    expect(rows, "running + completed fold into ONE row, never two").toHaveLength(1);
    const row = rows[0];
    expect(row.id).toBe(CALL_ID);
    expect(row.name).toBe("read");
    expect(row.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(row.args).toEqual(READ_ARGS);
    expect(row.result).toBe(READ_RESULT);
    expect(row.requiresApproval, "a read-only built-in is not gated").toBe(false);
    expect(row.startedAt < row.completedAt, "started before completed on the scripted clock").toBe(true);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
    expect(agent.runs[0].cancelCalls, "an ungated turn is never cancelled").toHaveLength(0);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const finalStatus = record.lastFullStatus;
    expect(finalStatus).toBeDefined();
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, finalStatus!), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/tool-call.status.json");
  });
});
