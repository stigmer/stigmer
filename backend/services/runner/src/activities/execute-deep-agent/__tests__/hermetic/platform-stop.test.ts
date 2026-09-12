/**
 * Hermetic golden: the PLATFORM STOP — the control plane answers a mid-stream
 * persist with `ExecutionControlSignal.STOP`.
 *
 * What the arm does: the record's `controlSignal` answers STOP on the first
 * full write that carries a tool row (the tool-call boundary forces that
 * persist, `persist-decision.ts` `contentDirty`); the stream loop reads the
 * signal off `persistStatus`'s response.
 *
 * What the golden shows about TODAY's behavior, recorded as found for
 * Q-S3-3 (ruled: a platform STOP is the platform saying "stop spending now";
 * the runtime's TERMINATED arm is the one enforcement; `graceful-stop.ts` is
 * deleted): on this harness the STOP does NOT stop the run.
 * `middleware/graceful-stop.ts` is always injected, so the loop calls
 * `gracefulStop.activate("Platform STOP signal")` instead of
 * `handleStop`'s COMPLETED-with-row terminal: the middleware blocks every
 * further tool and hands the model one more tool-free round to wrap up. The
 * transcript then carries the model's wrap-up AND the middleware's own notice
 * ("Platform STOP signal …"), which the v3 messages channel emits and
 * `V3StatusBuilder` renders as an ASSISTANT message (F-M0-7: an injected
 * notice appears as the agent's words); the run ends COMPLETED through the
 * normal epilogue with no system row and no `status.error`. The
 * `handleStop` copy "Execution stopped by the platform." is unreachable in
 * production. This golden (`goldens/platform-stop.status.json`) is the
 * pre-alignment shape M2b's predicted diff is measured against.
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

  it("activates the graceful stop and completes through the normal epilogue (today's shape)", async () => {
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

    // ── Assert: the STOP was delivered, and the run completed anyway ─────────
    expect(stopsAnswered, "the platform said STOP at least once").toBeGreaterThan(0);
    expect(invocation.outcome.kind).toBe("returned");
    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("EXECUTION_COMPLETED");
    expect(record.persistedPhases).toEqual([ExecutionPhase.EXECUTION_IN_PROGRESS, ExecutionPhase.EXECUTION_COMPLETED]);
    const final = record.lastFullStatus!;
    expect(final.error).toBe("");
    expect(final.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM), "handleStop's row is unreachable").toHaveLength(0);
    const ai = final.messages.filter((m) => m.type === MessageType.MESSAGE_AI).map((m) => m.content);
    expect(ai.slice(0, 3)).toEqual(["Let me look.", "", WRAP_UP]);
    expect(ai[3], "F-M0-7: the middleware's notice rendered as the agent's words").toMatch(/^Platform STOP signal/);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/platform-stop.status.json");
  });
});
