/**
 * Hermetic proof: the native harness gets the runtime's `turn_phases` timing
 * line without a line of its own.
 *
 * Invariant pinned: driving the REAL deepagents graph through the real native
 * translator, the turn runtime writes exactly one `turn_phases` line for the
 * turn, and the line reads what the translator's events said — one model
 * round per LangGraph run (two here: the proposal and the closing text), one
 * tool span for the `read_file` call, the three root instants present, the
 * adapter's own name as `harness`. The fold and its rules are
 * `harness/__tests__/turn-timeline.test.ts`'s; the runtime's act of writing
 * the line is `harness/__tests__/run-turn.test.ts`'s against the fake. What
 * only this file can prove is that the native translator emits the events the
 * fold needs (`message_start`/`message_finish` per run, `tool_started`/
 * `tool_finished` per call) in the order it needs them, on a real graph.
 *
 * Structural assertions only: the scripted clock makes every number
 * deterministic, but pinning one would pin the clock's tick quantum, not a
 * behaviour. The status goldens beside this file are untouched by design —
 * the line is stdout, never the status — and their byte-identity under this
 * change is proved by running them.
 *
 * Same scenario as `tool-call.test.ts`, so the two files read together.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
import { captureTimingLines } from "../../../../__test-utils__/timing-lines.js";
import { TURN_PHASES_EVENT } from "../../../../harness/turn-timeline.js";
import {
  beginDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
  sessionWorkspaceDir,
} from "../../__test-utils__/hermetic-deep-agent.js";

const CALL_ID = "call-hermetic-read-0001";
const USER_MESSAGE = "What is in README.md?";
const README = "# Hermetic\n\nA fixture readme.\n";
const ASSISTANT_TEXT = "README.md holds a one-line fixture description.";

describe("ExecuteDeepAgent hermetic — the runtime's turn_phases line", () => {
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

  it("writes one line for the turn, reading the translator's rounds and tool spans", async () => {
    const record = deepAgentExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => ({
        turns: [
          {
            text: "Let me read it.",
            toolCalls: [{ id: CALL_ID, name: "read_file", args: { file_path: "/README.md" } }],
            usage: { inputTokens: 1_500, outputTokens: 60 },
          },
          { text: ASSISTANT_TEXT, usage: { inputTokens: 1_700, outputTokens: 30 } },
        ],
      }),
    });
    const workspace = sessionWorkspaceDir(env);
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, "README.md"), README, "utf-8");

    const lines = await captureTimingLines(TURN_PHASES_EVENT, async () => {
      const invocation = await runDeepAgentTurn(scenario);
      expect(invocation.outcome.kind).toBe("returned");
    });

    expect(lines, "one line per turn").toHaveLength(1);
    const line = lines[0]!;
    expect(line.harness, "the adapter's diagnostic name, the runtime's vocabulary").toBe("deep-agent");
    expect(line.outcome).toBe("completed");
    expect(line.execution_id).toBe(record.execution.metadata!.id);
    expect(line.turn_seq).toBeTypeOf("number");

    expect(line.rounds, "the proposing run and the closing run").toBe(2);
    expect(line.tool_calls).toBe(1);
    expect(line.sub_agents).toBe(0);
    expect(line.segments.filter((s) => s.name === "model_round")).toHaveLength(2);
    expect(line.segments.filter((s) => s.name === "tool:read_file")).toHaveLength(1);

    expect(line.first_event_ms).toBeTypeOf("number");
    expect(line.first_visible_token_ms).toBeTypeOf("number");
    expect(line.first_text_ms).toBeTypeOf("number");
    expect(line.total_ms).toBeGreaterThanOrEqual(line.first_text_ms as number);
  });
});
