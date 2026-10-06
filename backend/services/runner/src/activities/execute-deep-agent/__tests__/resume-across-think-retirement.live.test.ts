/**
 * Live: a session saved with a `think` call, on the engine that still bound
 * the tool, resumes on Claude Haiku through the REAL `ExecuteDeepAgent`
 * activity and the real model client, on an engine that binds no `think`
 * (#1976).
 *
 * What the hermetic net (`hermetic/resume-across-think-retirement.test.ts`)
 * cannot show, and this does: the provider accepts the history. After the
 * approved `execute` runs, the model is sent a conversation whose round 0 is
 * a `tool_use` of `think` and its `tool_result`, while the request's `tools`
 * no longer carry `think`. The recorded rows are the hermetic net's fixture,
 * loaded into the session's sqlite checkpoint file as that net loads them;
 * only the model and the clock are real. A refusal by the provider fails the
 * case with the run's error printed.
 *
 * Live class (`*.live.test.ts`): runs only through `npm run test:live`, by
 * hand or in the live lane; skips without `ANTHROPIC_API_KEY` outside the lane
 * (`src/__test-utils__/live-gate.ts`), under `MAX_COST_USD`, on the control
 * plane's real registry (`real-model-registry.ts`).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fromJson } from "@bufbuild/protobuf";
import { AgentRunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { ApprovalAction, RunPhase, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";

vi.mock("../../../client/stigmer-client.js", async () =>
  (await import("../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { createHermeticEnvironment, type HermeticEnvironment } from "../../../__test-utils__/hermetic-activity.js";
import { liveSecret, recordLiveSpend, useProviderDirectly } from "../../../__test-utils__/live-gate.js";
import { stubRegistryFetch } from "../../../__test-utils__/model-registry-fixture.js";
import { realModelRegistry } from "../../../__test-utils__/real-model-registry.js";
import { getCheckpointDbPath } from "../../../shared/workspace/platform-dir.js";
import { EXECUTE_CALL_A } from "../__test-utils__/hitl-script.js";
import { FIXTURE, beginLiveDeepAgentScenario, deepAgentExecutionRecord, runDeepAgentTurn } from "../__test-utils__/hermetic-deep-agent.js";
import { loadRows } from "../__test-utils__/paused-session-fixture.js";
import { THINK_CALL_ID, THINK_RETIREMENT_MESSAGE, thinkBoundSession } from "../__test-utils__/think-bound-session.js";

const LIVE_MODEL = "claude-haiku-4.5";
const MAX_COST_USD = 0.05;

describe.skipIf(!liveSecret("ANTHROPIC_API_KEY"))("ExecuteDeepAgent live — a session saved with a think call resumes on Claude Haiku", () => {
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

  it("approves the paused command, sends the old think round to the provider, and completes under the cap", async () => {
    const fixture = thinkBoundSession();
    const record = deepAgentExecutionRecord({
      message: THINK_RETIREMENT_MESSAGE,
      modelName: LIVE_MODEL,
      maxCostUsd: MAX_COST_USD,
    });
    // The sqlite saver, so the recorded rows are the session's memory; the
    // live posture's default is the in-memory saver.
    const scenario = beginLiveDeepAgentScenario({ env, record, config: { checkpointerType: "sqlite" } });
    await loadRows(getCheckpointDbPath(FIXTURE.sessionId), fixture);
    record.applyStatusUpdate(fromJson(AgentRunStatusSchema, fixture.status));
    expect(record.waitingToolCalls().map((tc) => tc.id)).toEqual([EXECUTE_CALL_A.id]);
    expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE, new Date().toISOString())).toBe(1);

    await runDeepAgentTurn(scenario, { turnSeq: 1 });

    const final = record.lastFullStatus;
    const cost = final?.streamingUsage?.estimatedCostUsd ?? 0;
    recordLiveSpend("native resume across the think retirement (claude-haiku-4.5)", cost);
    const rows = record.toolCalls();
    const seen = rows.map((r) => `${r.name}:${ToolCallStatus[r.status]}`).join(", ");

    expect(record.persistedPhases.at(-1), `${final?.error ?? ""} rows: [${seen}]`).toBe(RunPhase.RUN_COMPLETED);
    const executed = rows.filter((r) => r.id === EXECUTE_CALL_A.id);
    expect(executed, `the approved command ran once; rows: [${seen}]`).toHaveLength(1);
    expect(executed[0]?.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(rows.filter((r) => r.id === THINK_CALL_ID), "the old think row stays").toHaveLength(1);
    expect(rows.filter((r) => r.name === "think" && r.id !== THINK_CALL_ID), "the model calls no new think").toHaveLength(0);
    expect(final?.messages.at(-1)?.content, "the model answered after the command").not.toBe("I will run the command.");
    expect(final?.messages.at(-1)?.content.length).toBeGreaterThan(0);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(MAX_COST_USD);
  });
});
