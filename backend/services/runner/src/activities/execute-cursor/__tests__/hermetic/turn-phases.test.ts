/**
 * Hermetic proof: the Cursor harness gets the runtime's `turn_phases` timing
 * line without a line of its own.
 *
 * Invariant pinned: driving the scripted Cursor SDK through the real Cursor
 * translator, the turn runtime writes exactly one `turn_phases` line for the
 * turn, and the line reads what the translator's events said — one model
 * round per minted segment (two here: the text before the tool call and the
 * text after it; the SDK's one `run_id` per `send()` is cut at every tool
 * call, `translator.ts`), one tool span for the `read` call closed at the
 * instant the SDK reported, the three root instants present, the adapter's
 * own name as `harness`. The fold and its rules are
 * `harness/__tests__/turn-timeline.test.ts`'s; the runtime's act of writing
 * the line is `harness/__tests__/run-turn.test.ts`'s against the fake. What
 * only this file can prove is that the Cursor translator emits the events the
 * fold needs, in the order it needs them, from the SDK's own stream shape.
 *
 * This line is the runtime's; the adapter's own `turn_first_event` line
 * (`turn-settle.ts`) measures the SDK's `send()` window, which the runtime
 * cannot see, and is not asserted here.
 *
 * Structural assertions only: the scripted clock makes every number
 * deterministic, but pinning one would pin the clock's tick quantum, not a
 * behaviour. The status goldens beside this file are untouched by design —
 * the line is stdout, never the status — and their byte-identity under this
 * change is proved by running them.
 *
 * Same scenario as `tool-call.test.ts`, so the two files read together.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { captureTimingLines } from "../../../../__test-utils__/timing-lines.js";
import { TURN_PHASES_EVENT } from "../../../../harness/turn-timeline.js";
import { ScriptedCursorAgent, sdkEvents, step } from "../../__test-utils__/scripted-agent.js";
import {
  FIXTURE,
  SDK_CATALOG,
  beginCursorScenario,
  cursorExecutionRecord,
  runCursorTurn,
} from "../../__test-utils__/hermetic-cursor.js";

const AGENT_ID = "agent-hermetic-tool-0001";
const RUN_ID = "run-hermetic-tool-0001";
const CALL_ID = "call-hermetic-read-0001";
const USER_MESSAGE = "What is in README.md?";
const READ_ARGS = { path: "README.md" };
const READ_RESULT = "# Hermetic\n\nA fixture readme.\n";
const ASSISTANT_TEXT = "README.md holds a one-line fixture description.";

describe("ExecuteCursor hermetic — the runtime's turn_phases line", () => {
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

  it("writes one line for the turn, reading the translator's segments and tool spans", async () => {
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
          step.turnEnded({ inputTokens: 2_000, outputTokens: 90, cacheReadTokens: 0, cacheWriteTokens: 0 }),
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

    const lines = await captureTimingLines(TURN_PHASES_EVENT, async () => {
      const invocation = await runCursorTurn(scenario);
      expect(invocation.outcome.kind).toBe("returned");
    });

    expect(lines, "one line per turn").toHaveLength(1);
    const line = lines[0]!;
    expect(line.harness, "the adapter's diagnostic name").toBe("cursor");
    expect(line.outcome).toBe("completed");
    expect(line.execution_id).toBe(record.execution.metadata!.id);
    expect(line.turn_seq).toBeTypeOf("number");

    expect(line.rounds, "the segment before the tool call and the one after it").toBe(2);
    expect(line.tool_calls).toBe(1);
    expect(line.sub_agents).toBe(0);
    expect(line.segments.filter((s) => s.name === "model_round")).toHaveLength(2);
    const toolSpan = line.segments.filter((s) => s.name === "tool:read");
    expect(toolSpan).toHaveLength(1);
    expect(toolSpan[0]!.duration_ms, "a span, not a point: the SDK's running and completed instants differ").toBeGreaterThan(0);

    expect(line.first_event_ms).toBeTypeOf("number");
    expect(line.first_visible_token_ms).toBeTypeOf("number");
    expect(line.first_text_ms).toBeTypeOf("number");
    expect(line.total_ms).toBeGreaterThanOrEqual(line.first_text_ms as number);
  });
});
