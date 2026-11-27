/**
 * Live: a Stigmer turn on a Gemini model paused for an approval between a
 * tool call and its result, then resumed, through the REAL `ExecuteDeepAgent`
 * activity, the real model client and LangChain's Google client, against
 * Google, on the durable (sqlite) checkpointer.
 *
 * What the hermetic `hermetic/gemini-turn.test.ts` cannot show, and this
 * does: Google accepts the conversation the resumed turn sends, whose
 * function call was signed by Google, checkpointed at the pause and read
 * back by a new invocation. A model that answers without calling `execute`
 * fails the case with the row list printed.
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
import { ApprovalAction, ToolCallStatus } from "../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

const LIVE_MODEL = "google:gemini-4-hydrogen";
const MAX_COST_USD = 0.05;
const WORD = "gemini-live-approval";

describe.skipIf(!liveSecret("GEMINI_API_KEY"))("ExecuteDeepAgent live — an approval between a tool call and its result, on a Gemini model", () => {
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

  it("pauses at the gated command, resumes on the approval, and completes with the command's result under the cap", async () => {
    const record = deepAgentExecutionRecord({
      message: `Run the shell command \`echo ${WORD}\` with the execute tool, then tell me in one sentence what it printed.`,
      modelName: LIVE_MODEL,
      maxCostUsd: MAX_COST_USD,
    });
    const scenario = beginLiveDeepAgentScenario({ env, record, config: { checkpointerType: "sqlite" } });

    await runDeepAgentTurn(scenario, { turnSeq: 0 });
    const paused = record.toolCalls().map((r) => `${r.name}:${ToolCallStatus[r.status]}`).join(", ");
    expect(record.persistedPhases.at(-1), `${record.lastFullStatus?.error ?? ""} rows: [${paused}]`).toBe(RunPhase.RUN_WAITING_FOR_APPROVAL);
    expect(record.waitingToolCalls().map((r) => r.name), `rows: [${paused}]`).toEqual(["execute"]);
    expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE, new Date().toISOString())).toBe(1);

    await runDeepAgentTurn(scenario, { turnSeq: 1 });

    const final = record.lastFullStatus;
    const cost = final?.streamingUsage?.estimatedCostUsd ?? 0;
    recordLiveSpend("Stigmer approval resume (gemini-4-hydrogen)", cost);
    const rows = record.toolCalls();
    const seen = rows.map((r) => `${r.name}:${ToolCallStatus[r.status]}`).join(", ");
    expect(record.persistedPhases.at(-1), `${final?.error ?? ""} rows: [${seen}]`).toBe(RunPhase.RUN_COMPLETED);
    const executed = rows.filter((r) => r.name === "execute");
    expect(executed, `rows: [${seen}]`).toHaveLength(1);
    expect(executed[0]?.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(executed[0]?.result).toContain(WORD);
    expect(final?.streamingUsage?.outputTokens).toBeGreaterThan(0n);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(MAX_COST_USD);
  });
});
