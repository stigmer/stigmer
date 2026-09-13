/**
 * Hermetic golden: the PLATFORM STOP — the control plane answers a mid-stream
 * persist with `ExecutionControlSignal.STOP`.
 *
 * What the arm does: the record's `controlSignal` answers STOP on the first
 * full write that carries a tool row (the tool-call boundary forces that
 * persist, `persist-decision.ts` `contentDirty`); the runtime's chokepoint
 * reads the signal off the write and aborts the adapter's `stopSignal`; the
 * adapter's loop, which AWAITED that persist, sees the abort before it pulls
 * the next event, cancels the graph run and settles `interrupted`; the
 * runtime's table maps the stop to COMPLETED with `platformStopArm`'s one
 * row, "Execution stopped by the platform.", no `status.error`, and RETURNS.
 *
 * Ruled at Q-S3-3 (a platform STOP is the platform saying "stop spending
 * now"; the runtime's abort is the one stop) and landed at S3 M2a. Until
 * then the orchestrator answered STOP by activating `graceful-stop.ts`,
 * which handed the model one more tool-free round: the transcript carried
 * the model's wrap-up ("Stopping here as asked.") AND the middleware's own
 * notice rendered as the agent's words (F-M0-7), and the run ended
 * COMPLETED with no row. The graceful-stop middleware was deleted at S3 M2b
 * (Q-M2a-4 sequenced it after the legacy loop that activated it); nothing in
 * the graph answers a STOP any more, so the second scripted turn is never
 * reached — this golden was byte-identical across the deletion.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-deep-agent/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ExecutionControlSignal,
  ExecutionPhase,
  MessageType,
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

const READ_CALL = { id: "call-hermetic-read-0001", name: "read_file", args: { file_path: "/notes.md" } };
const WRAP_UP = "Stopping here as asked.";

describe("ExecuteDeepAgent hermetic — platform STOP", () => {
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

  it("stops the run at the STOP and completes with the platform-stop row (Q-S3-3)", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    let stopsAnswered = 0;
    const record = deepAgentExecutionRecord({
      message: "Look at my notes.",
      controlSignal: (status) => {
        if (status.messages.some((m) => m.toolCalls.length > 0)) {
          stopsAnswered += 1;
          return ExecutionControlSignal.STOP;
        }
        return ExecutionControlSignal.UNSPECIFIED;
      },
    });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => ({
        turns: [
          { text: "Let me look.", toolCalls: [READ_CALL], usage: { inputTokens: 1_200, outputTokens: 30 } },
          { text: WRAP_UP, usage: { inputTokens: 1_400, outputTokens: 10 } },
        ],
      }),
    });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runDeepAgentTurn(scenario);

    // ── Assert: the STOP was delivered, and the run stopped there ────────────
    expect(stopsAnswered, "the platform said STOP at least once").toBeGreaterThan(0);
    expect(invocation.outcome.kind, "a platform stop RETURNS").toBe("returned");
    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("EXECUTION_COMPLETED");
    expect(record.persistedPhases).toEqual([ExecutionPhase.EXECUTION_IN_PROGRESS, ExecutionPhase.EXECUTION_COMPLETED]);
    const final = record.lastFullStatus!;
    expect(final.error).toBe("");
    expect(final.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM).map((m) => m.content)).toEqual([
      "Execution stopped by the platform.",
    ]);
    const ai = final.messages.filter((m) => m.type === MessageType.MESSAGE_AI).map((m) => m.content);
    expect(ai, "no wrap-up round and no injected notice: the run stopped at the STOP").toEqual(["Let me look.", ""]);
    expect(ai).not.toContain(WRAP_UP);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/platform-stop.status.json");
  });
});
