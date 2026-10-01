/**
 * Live: one native (deep-agent) turn on Claude Haiku, the cheapest native
 * model, through the REAL `ExecuteDeepAgent` activity and the real model
 * client against Anthropic, and the execution's own cost cap ending a turn
 * that crosses it.
 *
 * What the hermetic `hermetic/plain-turn.test.ts` cannot show, and this does:
 * the registry's real provider id for the model is one Anthropic answers, the
 * provider's response folds into a completed record with its usage, the price
 * table knows the real model (the estimate is above zero), and the runtime's
 * cost cap (`cost-guard.ts`) stops a turn on a real estimate. Assertions read
 * structure and side effects, never the model's words.
 *
 * Live class (`*.live.test.ts`): runs only through `npm run test:live`, by
 * hand or in the live lane; skips without `ANTHROPIC_API_KEY` outside the lane
 * (`src/__test-utils__/live-gate.ts`). The turn runs under `MAX_COST_USD`; the
 * cap case under a cap it cannot stay below. The registry served is the
 * control plane's real one (`real-model-registry.ts`), so the provider id and
 * the prices are the ones users get.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ExecutionPhase, MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

vi.mock("../../../client/stigmer-client.js", async () =>
  (await import("../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { createHermeticEnvironment, type HermeticEnvironment } from "../../../__test-utils__/hermetic-activity.js";
import { liveSecret, recordLiveSpend, useProviderDirectly } from "../../../__test-utils__/live-gate.js";
import { stubRegistryFetch } from "../../../__test-utils__/model-registry-fixture.js";
import { realModelRegistry } from "../../../__test-utils__/real-model-registry.js";
import { COST_LIMIT_ERROR_PREFIX } from "../../../shared/cost-guard.js";
import { beginLiveDeepAgentScenario, deepAgentExecutionRecord, runDeepAgentTurn } from "../__test-utils__/hermetic-deep-agent.js";

/** The cheapest native model in the registry; the record names it, so the default model is never consulted. */
const LIVE_MODEL = "claude-haiku-4.5";
/** The execution's own cost cap: a turn that would spend more is ended TERMINATED by the runtime. */
const MAX_COST_USD = 0.05;
/** A cap no real turn can stay below, for the case that proves the cap. */
const UNREACHABLE_COST_USD = 0.0001;

describe.skipIf(!liveSecret("ANTHROPIC_API_KEY"))("ExecuteDeepAgent live — a plain turn on Claude Haiku", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  let restoreEnv: () => void;

  beforeAll(() => {
    // Anthropic itself: no gateway, cloud backend or proxy from the shell.
    restoreEnv = useProviderDirectly();
    env = createHermeticEnvironment();
    registry = stubRegistryFetch({ live: true, document: realModelRegistry() });
  });

  afterAll(() => {
    registry.restore();
    env.dispose();
    restoreEnv();
  });

  it("completes with a reply, its usage and an estimated cost under the cap", async () => {
    // Approvals stay required: a gated tool a real model reaches for must never run
    // unreviewed on the machine running the live check, whose environment holds the
    // provider keys. The prompt asks for no tool (a live run once paused on a gated
    // call); a model that still reaches for one fails the case, naming the row.
    const record = deepAgentExecutionRecord({
      message: "Without calling any tool, reply with one short sentence saying the live check ran.",
      modelName: LIVE_MODEL,
      maxCostUsd: MAX_COST_USD,
    });
    const invocation = await runDeepAgentTurn(beginLiveDeepAgentScenario({ env, record }));

    const final = record.lastFullStatus;
    const cost = final?.streamingUsage?.estimatedCostUsd ?? 0;
    recordLiveSpend("native plain turn (claude-haiku-4.5)", cost);

    const rows = record.toolCalls().map((r) => `${r.name}:${ToolCallStatus[r.status]}`).join(", ");
    expect(invocation.outcome.kind, final?.error).toBe("returned");
    expect(record.persistedPhases.at(-1), `${final?.error ?? ""} tool rows: [${rows}]`).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    const ai = (final?.messages ?? []).filter((m) => m.type === MessageType.MESSAGE_AI);
    expect(ai.length, "at least one assistant message").toBeGreaterThan(0);
    expect(ai.at(-1)?.content.trim().length, "the last assistant message carries text").toBeGreaterThan(0);
    expect(final?.streamingUsage?.inputTokens ?? 0n).toBeGreaterThan(0n);
    expect(final?.streamingUsage?.outputTokens ?? 0n).toBeGreaterThan(0n);
    expect(cost, "the price table knows the real model").toBeGreaterThan(0);
    expect(cost).toBeLessThan(MAX_COST_USD);
  });

  it("ends TERMINATED with the cost-limit error when the turn crosses its cap", async () => {
    const record = deepAgentExecutionRecord({
      message: "Reply with one short sentence.",
      modelName: LIVE_MODEL,
      maxCostUsd: UNREACHABLE_COST_USD,
    });
    await runDeepAgentTurn(beginLiveDeepAgentScenario({ env, record }));

    const final = record.lastFullStatus;
    recordLiveSpend("native cost-cap stop (claude-haiku-4.5)", final?.streamingUsage?.estimatedCostUsd);

    expect(record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_TERMINATED);
    expect(final?.error.startsWith(COST_LIMIT_ERROR_PREFIX), final?.error).toBe(true);
  });
});
