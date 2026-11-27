/**
 * Live: one Stigmer turn on a Gemini model that calls two built-in tools
 * one after the other, through the REAL `ExecuteDeepAgent` activity, the real
 * model client and LangChain's Google client, against Google.
 *
 * What the hermetic `hermetic/gemini-turn.test.ts` cannot show, and this
 * does: Google's own tool-call wire as it is today, from the declarations
 * the engine sends to the signed calls the model returns and the results the
 * engine feeds back, two steps deep, folded into completed rows, with the
 * turn's usage counted. `write_todos` is the tool asked for because it has no
 * side effect outside the record and needs no approval. A model that answers
 * without calling it fails the case with the row list printed; that is a
 * reading for the reader, never a retry.
 *
 * Live class (`*.live.test.ts`): runs only through `npm run test:live`, by
 * hand or in the live lane; skips without `GEMINI_API_KEY` outside the lane
 * (`src/__test-utils__/live-gate.ts`), under `MAX_COST_USD`. The registry
 * holds no Gemini row yet, so the run is priced at the runner's default rate.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

vi.mock("../../../client/stigmer-client.js", async () =>
  (await import("../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { createHermeticEnvironment, type HermeticEnvironment } from "../../../__test-utils__/hermetic-activity.js";
import { liveSecret, recordLiveSpend, useProviderDirectly } from "../../../__test-utils__/live-gate.js";
import { stubRegistryFetch } from "../../../__test-utils__/model-registry-fixture.js";
import { realModelRegistry } from "../../../__test-utils__/real-model-registry.js";
import { beginLiveDeepAgentScenario, deepAgentExecutionRecord, runDeepAgentTurn } from "../__test-utils__/hermetic-deep-agent.js";
import { ToolCallStatus } from "../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

const LIVE_MODEL = "google:gemini-4-hydrogen";
const MAX_COST_USD = 0.05;
const TOOL = "write_todos";

describe.skipIf(!liveSecret("GEMINI_API_KEY"))("ExecuteDeepAgent live — two tool calls on a Gemini model", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  let restoreEnv: () => void;

  beforeAll(() => {
    restoreEnv = useProviderDirectly();
    env = createHermeticEnvironment();
    registry = stubRegistryFetch({ live: true, document: realModelRegistry() });
  });

  afterAll(() => {
    registry.restore();
    env.dispose();
    restoreEnv();
  });

  it("calls write_todos twice, both rows complete, and the turn completes with its usage under the cap", async () => {
    const record = deepAgentExecutionRecord({
      message:
        `Call the ${TOOL} tool with one todo whose content is "live check" and status "in_progress". ` +
        `When it returns, call ${TOOL} again with the same todo and status "completed". ` +
        "Then reply with one short sentence. Do not call any other tool.",
      modelName: LIVE_MODEL,
      maxCostUsd: MAX_COST_USD,
    });
    await runDeepAgentTurn(beginLiveDeepAgentScenario({ env, record }));

    const final = record.lastFullStatus;
    const cost = final?.streamingUsage?.estimatedCostUsd ?? 0;
    recordLiveSpend("Stigmer tool calls (gemini-4-hydrogen)", cost);
    const rows = record.toolCalls();
    const seen = rows.map((r) => `${r.name}:${ToolCallStatus[r.status]}`).join(", ");

    expect(record.persistedPhases.at(-1), `${final?.error ?? ""} rows: [${seen}]`).toBe(RunPhase.RUN_COMPLETED);
    const todoRows = rows.filter((r) => r.name === TOOL);
    expect(todoRows.length, `the model called ${TOOL} twice; rows: [${seen}]`).toBe(2);
    expect(todoRows.every((r) => r.status === ToolCallStatus.TOOL_CALL_COMPLETED), `rows: [${seen}]`).toBe(true);
    expect(final?.streamingUsage?.inputTokens).toBeGreaterThan(0n);
    expect(final?.streamingUsage?.outputTokens).toBeGreaterThan(0n);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(MAX_COST_USD);
  });
});
