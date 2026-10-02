/**
 * Live: one native (deep-agent) turn on Claude Haiku that must call a
 * built-in tool, through the REAL `ExecuteDeepAgent` activity and the real
 * model client against Anthropic.
 *
 * What the hermetic `hermetic/write-todos.test.ts` cannot show, and this does:
 * the provider's tool-use wire as it is today, from the tool definitions the
 * engine sends to the call the model returns and the result the engine feeds
 * back, folded into a completed row. `write_todos` is the tool asked for
 * because it has no side effect outside the record and needs no approval.
 * A model that answers without calling the tool fails the case with the row
 * list printed; that is a reading for the reader, never a retry.
 *
 * Live class (`*.live.test.ts`): runs only through `npm run test:live`, by
 * hand or in the live lane; skips without `ANTHROPIC_API_KEY` outside the lane
 * (`src/__test-utils__/live-gate.ts`), under `MAX_COST_USD`, on the control
 * plane's real registry (`real-model-registry.ts`).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ExecutionPhase, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

vi.mock("../../../client/stigmer-client.js", async () =>
  (await import("../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { createHermeticEnvironment, type HermeticEnvironment } from "../../../__test-utils__/hermetic-activity.js";
import { liveSecret, recordLiveSpend } from "../../../__test-utils__/live-gate.js";
import { stubRegistryFetch } from "../../../__test-utils__/model-registry-fixture.js";
import { realModelRegistry } from "../../../__test-utils__/real-model-registry.js";
import { beginLiveDeepAgentScenario, deepAgentExecutionRecord, runDeepAgentTurn } from "../__test-utils__/hermetic-deep-agent.js";

const LIVE_MODEL = "claude-haiku-4.5";
const MAX_COST_USD = 0.05;
const TOOL = "write_todos";

describe.skipIf(!liveSecret("ANTHROPIC_API_KEY"))("ExecuteDeepAgent live — a built-in tool call on Claude Haiku", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;

  beforeAll(() => {
    env = createHermeticEnvironment();
    registry = stubRegistryFetch({ live: true, document: realModelRegistry() });
  });

  afterAll(() => {
    registry.restore();
    env.dispose();
  });

  it("calls write_todos once, the row completes, and the turn completes under the cap", async () => {
    // Approvals stay required (`write_todos` needs none): a gated tool the model reaches
    // for must never run unreviewed where the provider keys live; it fails the case.
    const record = deepAgentExecutionRecord({
      message:
        `Call the ${TOOL} tool exactly once with a single todo whose content is "live check" and status "completed". ` +
        "Then reply with one short sentence. Do not call any other tool.",
      modelName: LIVE_MODEL,
      maxCostUsd: MAX_COST_USD,
    });
    await runDeepAgentTurn(beginLiveDeepAgentScenario({ env, record }));

    const final = record.lastFullStatus;
    const cost = final?.streamingUsage?.estimatedCostUsd ?? 0;
    recordLiveSpend("native tool call (claude-haiku-4.5)", cost);
    const rows = record.toolCalls();
    const seen = rows.map((r) => `${r.name}:${ToolCallStatus[r.status]}`).join(", ");

    expect(record.persistedPhases.at(-1), `${final?.error ?? ""} rows: [${seen}]`).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    const todoRows = rows.filter((r) => r.name === TOOL);
    expect(todoRows.length, `the model called ${TOOL} exactly once; rows: [${seen}]`).toBe(1);
    expect(todoRows[0]?.status, `rows: [${seen}]`).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(MAX_COST_USD);
  });
});
