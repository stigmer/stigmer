/**
 * Hermetic goldens: how a Claude turn ends when something other than its
 * own answer ends it, on the real engine.
 *
 *  - A platform STOP (the control plane answers a persist with
 *    `RunControlSignal.STOP`) while the engine waits on a model call: the
 *    runtime raises the stop, the adapter interrupts the engine, and the run
 *    completes with what it had, the held answer never seen.
 *  - A structured-output turn: the engine answers through the tool it adds
 *    for an answer schema (`StructuredOutput`), which the gate knows as one
 *    the turn offers, and the answer lands as the run's structured output.
 *
 * A message sent while the turn works, and a yield at the worker's drain,
 * are the runtime kit's (`harness-contract.test.ts`, its "messages sent
 * while the turn works" and "long turn" arms), run on this same engine.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-claude/__tests__/hermetic/signals.test.ts -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RunControlSignal } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment, rowsGolden, rowsGoldenPath, statusGolden, type ExecutionRecord } from "../../../../__test-utils__/hermetic-activity.js";
import { MessageType, ToolCallStatus } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { anthropicText, anthropicToolUses } from "../../__test-utils__/claude-wire.js";
import { claudeExecutionRecord, claudeScenarioFile } from "../../__test-utils__/hermetic-claude.js";
import { STRUCTURED_OUTPUT_TOOL } from "../../engine-options.js";

const env = createHermeticEnvironment();
const clock = new ScriptedClock();
const file = claudeScenarioFile(env, clock);
const NEVER_SEEN = "This answer is never seen.";

async function goldens(record: ExecutionRecord, name: string): Promise<void> {
  const final = record.lastFullStatus!;
  await expect(statusGolden(final)).toMatchFileSnapshot(`./goldens/${name}.status.json`);
  await expect(rowsGolden(record.rowsOf(final))).toMatchFileSnapshot(rowsGoldenPath(`./goldens/${name}.status.json`));
  await expect(record.eventsGolden()).toMatchFileSnapshot(`./goldens/${name}.events.json`);
}

describe("ExecuteClaude hermetic — signals", () => {
  beforeAll(() => file.start());
  afterAll(() => file.stop());

  it("a platform STOP while the engine waits on its model ends the run with what it had", async () => {
    let stopsAnswered = 0;
    const record = claudeExecutionRecord({
      message: "Look around.",
      controlSignal: (_status, rows) => {
        if (rows.messages.some((m) => m.toolCalls.some((tc) => tc.id === "toolu_stop_glob" && tc.status === ToolCallStatus.TOOL_CALL_COMPLETED))) {
          stopsAnswered += 1;
          return RunControlSignal.STOP;
        }
        return RunControlSignal.UNSPECIFIED;
      },
    });
    const invocation = await file.run(record, (c) => {
      if (!c.issued.has("toolu_stop_glob")) return anthropicToolUses([{ toolCallId: "toolu_stop_glob", toolName: "Glob", toolInput: { pattern: "**/*.md" } }]);
      // The held call takes back its clock step: whether it reaches the model
      // before the stop settles is the machine's timing (a loaded CI runner
      // lands it first), never the scenario's, so the golden holds either way.
      vi.setSystemTime(Date.now() - ScriptedClock.STEP_MS);
      return { body: anthropicText(NEVER_SEEN), delayMs: 120_000 };
    });

    expect(stopsAnswered, "the platform said STOP").toBeGreaterThan(0);
    expect(invocation.outcome.kind, "a platform stop returns").toBe("returned");
    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
    const rows = record.rowsOf(record.lastFullStatus!);
    expect(rows.messages.filter((m) => m.type === MessageType.MESSAGE_AI).map((m) => m.content)).not.toContain(NEVER_SEEN);
    await goldens(record, "platform-stop");
  });

  it("a structured-output turn answers through the engine's own tool, and the answer is the run's", async () => {
    const schema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
    const record = claudeExecutionRecord({ message: "What is six times seven?", structuredOutputSchema: schema });
    const invocation = await file.run(record, (c) =>
      c.issued.has("toolu_answer") ? anthropicText("") : anthropicToolUses([{ toolCallId: "toolu_answer", toolName: STRUCTURED_OUTPUT_TOOL, toolInput: { answer: "42" } }]),
    );

    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
    const rows = record.rowsOf(record.lastFullStatus!);
    expect(rows.structuredOutput).toEqual({ answer: "42" });
    await goldens(record, "structured-output");
  });
});
