/**
 * Hermetic golden: the simplest possible turn through the whole
 * `ExecuteDeepAgent` activity — one user message in, one assistant message
 * out, no tools, no gate, no workspace entries.
 *
 * Invariant pinned: the activity resolves the four-resource chain, builds the
 * REAL deepagents graph, streams it through the v3 protocol into
 * `TranscriptBuilder`, persists IN_PROGRESS then COMPLETED, and returns the slim
 * status. The golden (`goldens/plain-turn.status.json`) is the smallest
 * status the Stigmer harness produces: one AI message with the scripted text
 * and the scripted usage, `startedAt` / `completedAt` on the scripted clock.
 *
 * This file is also the PROBE the Stigmer net opened with (#1096): no earlier test drove the
 * real graph through `streamEvents(..., { version: "v3" })`. The scripted
 * model streams, so the events under this golden are the ones a provider
 * produces (`scripted-model.ts` header).
 *
 * The model the turn builds is the one the control plane resolved
 * (`status.run_config`), never the one the request asked for
 * (`spec.run_config`): a request that disagrees with the resolution runs the
 * resolution.
 * An empty `thread_id` rode here too (carried from `index.test.ts`: "handles
 * empty threadId gracefully") until @langchain/langgraph-checkpoint 1.1's
 * memory saver started refusing an empty key. That arm was only ever true of
 * the test-only memory saver: the Stigmer thread id is runtime-minted
 * (`EnsureThread` sends `thread-{sessionId}` on every invocation), and the
 * sqlite saver the runner ships has always refused an empty one
 * (`shared/checkpointer/sqlite-saver.ts`), so no saver left to prove it on.
 *
 * Since #1096 the activity is the turn runtime over the Stigmer harness's adapter, and
 * `streamingUsage` carries the runtime accountant's fields — `model`,
 * `estimatedCostUsd` priced at the registry's rates, the requested tier and
 * thinking mode (one writer of the summary, the runtime). Nothing
 * else in this golden moved with the flip.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-deep-agent/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { RunConfigSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/invocation_pb";

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
  statusGolden,
  rowsGolden,
  rowsGoldenPath,
} from "../../../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import {
  FIXTURE,
  beginDeepAgentScenario,
  deepAgentExecutionRecord,
  runDeepAgentTurn,
  type DeepAgentRecordOptions,
  type DeepAgentTurnOptions,
} from "../../__test-utils__/hermetic-deep-agent.js";
import { recordedModelBuilds } from "../../__test-utils__/scripted-model-module.js";
import { MessageType } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

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

  async function runPlainTurn(turn: DeepAgentTurnOptions = {}, recordOptions: Partial<DeepAgentRecordOptions> = {}) {
    clock.reset();
    const record = deepAgentExecutionRecord({ message: USER_MESSAGE, ...recordOptions });
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
    expect(slim.phase).toBe("RUN_COMPLETED");
    expect(record.persistedPhases).toEqual([
      RunPhase.RUN_IN_PROGRESS,
      RunPhase.RUN_COMPLETED,
    ]);

    // ── Assert: the transcript ───────────────────────────────────────────────
    const final = record.lastFullStatus!;
    const finalRows = record.rowsOf(final);
    const ai = finalRows.messages.filter((m) => m.type === MessageType.MESSAGE_AI);
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
    await expect(statusGolden(record.lastFullStatus!)).toMatchFileSnapshot(GOLDEN);
    await expect(rowsGolden(record.rowsOf(record.lastFullStatus!))).toMatchFileSnapshot(rowsGoldenPath(GOLDEN));
    await expect(record.eventsGolden()).toMatchFileSnapshot(GOLDEN.replace(".status.json", ".events.json"));
  });

  it("builds the model the resolved settings name, never the one the request asked for", async () => {
    const { invocation } = await runPlainTurn({}, {
      requestRunConfig: create(RunConfigSchema, { modelName: "request-only-model" }),
    });
    expect(invocation.outcome.kind).toBe("returned");
    const builds = recordedModelBuilds();
    expect(builds[0]?.modelName, "status.runConfig.modelName").toBe(FIXTURE.model);
    expect(builds.map((b) => b.modelName)).not.toContain("request-only-model");
  });
});
