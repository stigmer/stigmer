/**
 * Hermetic golden: the simplest possible turn through the whole
 * `ExecuteDeepAgent` activity — one user message in, one assistant message
 * out, no tools, no gate, no workspace entries.
 *
 * Invariant pinned: the activity resolves the four-resource chain, builds the
 * REAL deepagents graph, streams it through the v3 protocol into
 * `V3StatusBuilder`, persists IN_PROGRESS then COMPLETED, and returns the slim
 * status. The golden (`goldens/plain-turn.status.json`) is the smallest
 * status the native harness produces: one AI message with the scripted text
 * and the scripted usage, `startedAt` / `completedAt` on the scripted clock.
 *
 * This file is also the PROBE the M0 plan named: no earlier test drove the
 * real graph through `streamEvents(..., { version: "v3" })`. The scripted
 * model streams, so the events under this golden are the ones a provider
 * produces (`scripted-model.ts` header).
 *
 * Two shapes of the activity's wire contract ride on the same golden, and
 * matching the SAME file is the assertion that they are invisible to the
 * status: the legacy positional `(executionId, threadId)` form the control
 * planes still may send (`shared/activity-input.ts`), and an empty
 * `thread_id` (carried from `index.test.ts`: "handles empty threadId
 * gracefully").
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-deep-agent/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase, MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

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
  FIXTURE,
  beginDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
  type DeepAgentTurnOptions,
} from "../../__test-utils__/hermetic-deep-agent.js";
import { recordedModelBuilds } from "../../__test-utils__/scripted-model-module.js";

const USER_MESSAGE = "Say hello.";
const ASSISTANT_TEXT = "Hello from the hermetic fixture agent.";
const GOLDEN = "./goldens/plain-turn.status.json";

describe("ExecuteDeepAgent hermetic — plain turn", () => {
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

  async function runPlainTurn(turn: DeepAgentTurnOptions = {}) {
    clock.reset();
    const record = deepAgentExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => ({ turns: [{ text: ASSISTANT_TEXT, usage: { inputTokens: 1_200, outputTokens: 30 } }] }),
    });
    const invocation = await runDeepAgentTurn(scenario, turn);
    return { record, invocation };
  }

  it("persists IN_PROGRESS then COMPLETED with one assistant message and returns the slim status", async () => {
    // ── Act ──────────────────────────────────────────────────────────────────
    const { record, invocation } = await runPlainTurn();

    // ── Assert: outcome and phases ───────────────────────────────────────────
    expect(invocation.outcome.kind).toBe("returned");
    const slim = (invocation.outcome as { value: Record<string, unknown> }).value;
    expect(slim.phase).toBe("EXECUTION_COMPLETED");
    expect(record.persistedPhases).toEqual([
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_COMPLETED,
    ]);

    // ── Assert: the transcript ───────────────────────────────────────────────
    const final = record.lastFullStatus!;
    const ai = final.messages.filter((m) => m.type === MessageType.MESSAGE_AI);
    expect(ai, "one assistant message, no tool rows").toHaveLength(1);
    expect(ai[0].content).toBe(ASSISTANT_TEXT);
    expect(ai[0].toolCalls).toHaveLength(0);
    expect(final.streamingUsage?.inputTokens).toBe(1_200n);
    expect(final.streamingUsage?.outputTokens).toBe(30n);

    // ── Assert: hermeticity and what production asked the model client for ──
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
    const primaryBuild = recordedModelBuilds()[0];
    expect(primaryBuild?.modelName, "the execution's model, not the default").toBe(FIXTURE.model);
    expect(primaryBuild?.proxyEndpoint, "the OSS posture has no proxy").toBeUndefined();

    // ── Assert: the golden ───────────────────────────────────────────────────
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot(GOLDEN);
  });

  it("produces the same status from the legacy positional wire shape", async () => {
    const { record, invocation } = await runPlainTurn({ positional: true });
    expect(invocation.outcome.kind).toBe("returned");
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, record.lastFullStatus!), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot(GOLDEN);
  });

  it("produces the same status with an empty thread_id", async () => {
    const { record, invocation } = await runPlainTurn({ threadId: "" });
    expect(invocation.outcome.kind).toBe("returned");
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, record.lastFullStatus!), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot(GOLDEN);
  });
});
