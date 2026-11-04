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
 *  - A drain while a call runs: the engine itself stops at the batch
 *    boundary (the gate's `PostToolBatch` hook), keeping the call's result
 *    and asking its model nothing more; the continuation reads the result
 *    and asks the next round (stigmer#2855).
 *
 * A message sent while the turn works, and the yield's other cases at the
 * worker's drain, are the runtime kit's (`harness-contract.test.ts`, its
 * "messages sent while the turn works" and "long turn" arms), run on this
 * same engine.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-claude/__tests__/hermetic/signals.test.ts -u
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RunControlSignal } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import {
  ScriptedClock,
  continuationCauseOf,
  createHermeticEnvironment,
  rowsGolden,
  rowsGoldenPath,
  statusGolden,
  type ExecutionRecord,
  type InvocationControls,
} from "../../../../__test-utils__/hermetic-activity.js";
import { MessageType, ToolCallStatus } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { anthropicText, anthropicToolUses, type WireConversation } from "../../__test-utils__/claude-wire.js";
import { claudeExecutionRecord, claudeScenarioFile, sessionWorkspaceDir } from "../../__test-utils__/hermetic-claude.js";
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

  it("a drain while a call runs stops the engine at the batch boundary: the result is kept, the model is not asked again, the continuation asks the next round", async () => {
    // stigmer#2855: the yield's boundary is held inside the engine (the
    // gate's `PostToolBatch` hook, `gate.ts`), not by the runner's interrupt
    // alone, which reaches the engine only after it has the tool's result
    // and may already have asked its model for the next reply.
    const record = claudeExecutionRecord({ message: "Build it.", autoApproveAll: true });
    const dir = sessionWorkspaceDir(env);
    const opened = join(dir, ".build-open");
    const release = join(dir, ".build-release");
    const build = "toolu_drain_build";
    const command = `echo ran >> .build-ledger; touch .build-open; while [ ! -f .build-release ]; do sleep 0.05; done; echo built`;
    let controls: InvocationControls | undefined;
    let pastTheBoundary = 0;
    const running = file.run(
      record,
      (c) => {
        if (!c.issued.has(build)) return anthropicToolUses([{ toolCallId: build, toolName: "Bash", toolInput: { command } }]);
        pastTheBoundary += 1;
        return anthropicText(NEVER_SEEN);
      },
      { onControls: (c) => (controls = c) },
    );
    await vi.waitFor(() => expect(existsSync(opened), "the build is running").toBe(true), { timeout: 30_000, interval: 20 });
    controls!.signalWorkerShutdown();
    // The pipe to the agent host delivers on a microtask: one macrotask turn
    // and the yield is in the engine's turn before the build is let finish.
    await new Promise((resolve) => setImmediate(resolve));
    writeFileSync(release, "");
    const first = await running;

    expect(continuationCauseOf(first.outcome), "the drained invocation continues").toBe("drain");
    const row = record.toolCalls().find((tc) => tc.id === build);
    expect(row?.status, "the build's result is in the transcript").toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(pastTheBoundary, "the engine asked its model nothing after the batch").toBe(0);
    const rows = record.rowsOf(record.lastFullStatus!);
    expect(rows.messages.filter((m) => m.type === MessageType.MESSAGE_AI).map((m) => m.content)).not.toContain(NEVER_SEEN);

    let resumedWith: WireConversation | undefined;
    const second = await file.resume(
      record,
      (c) => {
        resumedWith = c;
        return anthropicText("Picked up where I left off.");
      },
      { turnSeq: 1 },
    );
    expect(second.outcome.kind, "the continuation completes").toBe("returned");
    expect((second.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
    expect(resumedWith?.toolResults.get(build)?.text, "the continuation's engine holds the build's result").toContain("built");
    expect(readFileSync(join(dir, ".build-ledger"), "utf8"), "the build ran once across both invocations").toBe("ran\n");
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
