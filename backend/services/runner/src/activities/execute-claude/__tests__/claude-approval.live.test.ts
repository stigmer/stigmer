/**
 * Live: one Claude engine turn on Claude Haiku whose shell call waits for a
 * person, is approved, and runs exactly that call, through the REAL
 * `ExecuteClaude` activity, the real engine at the runner's pin, and
 * Anthropic itself.
 *
 * What the hermetic `hermetic/approvals.test.ts` cannot show, and this does:
 * the engine at the version the runner pins, against today's API. Its own
 * system prompt and tools reach the model, the model's call reaches the
 * gate, the gate's `defer` ends the invocation with the call waiting, and
 * the next invocation resumes the engine from the session's store and runs
 * the approved call once. It is the check an engine upgrade runs before it
 * is merged (`.agents/skills/upgrade-claude-engine/SKILL.md`). A model that
 * answers without the call fails the case with the rows printed; that is a
 * reading for the reader, never a retry.
 *
 * The runner here is in direct mode, as an open-source runner is: no
 * platform proxy, the agent host's model lane is the runner's own proxy,
 * and that lane sends the runner's `ANTHROPIC_API_KEY` (`agent-proxy/
 * lanes.ts`); the engine itself only ever holds its turn's key.
 *
 * Live class (`*.live.test.ts`): runs only through `npm run test:live`, by
 * hand or in the live lane; skips without `ANTHROPIC_API_KEY` outside the
 * lane (`src/__test-utils__/live-gate.ts`), under `MAX_COST_USD`, on the
 * control plane's real registry (`real-model-registry.ts`).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

vi.mock("../../../client/stigmer-client.js", async () =>
  (await import("../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { AgentProxy } from "../../../agent-proxy/server.js";
import type { Config } from "../../../config.js";
import { ApprovalAction, ToolCallStatus } from "../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { bindHermeticClient, createHermeticEnvironment, type HermeticEnvironment } from "../../../__test-utils__/hermetic-activity.js";
import { liveSecret, recordLiveSpend, useProviderDirectly } from "../../../__test-utils__/live-gate.js";
import { routeModelCallsThroughLanes } from "../../../shared/model-lanes.js";
import { stubRegistryFetch } from "../../../__test-utils__/model-registry-fixture.js";
import { realModelRegistry } from "../../../__test-utils__/real-model-registry.js";
import { claudeExecutionRecord, hermeticClaudeConfig, resetClaudeScenarioState, runClaudeInvocation, sessionWorkspaceDir } from "../__test-utils__/hermetic-claude.js";

const LIVE_MODEL = "claude-haiku-4.5";
const MAX_COST_USD = 0.1;
const MARKER = "live-claude-approval";
const DECIDED_AT = "2026-01-01T00:00:30.000Z";

describe.skipIf(!liveSecret("ANTHROPIC_API_KEY"))("ExecuteClaude live — a shell call that waits for a person, on Claude Haiku", () => {
  let env: HermeticEnvironment;
  let config: Config;
  let proxy: AgentProxy;
  let registry: ReturnType<typeof stubRegistryFetch>;
  let restoreEnv: () => void;

  beforeAll(async () => {
    // Anthropic itself: no gateway, cloud backend or proxy from the shell.
    restoreEnv = useProviderDirectly();
    env = createHermeticEnvironment();
    config = hermeticClaudeConfig(env, { proxyEndpoint: null });
    proxy = await AgentProxy.start(config);
    // What the agent host's entry does in direct mode (`agent-host/entry.ts`):
    // its model clients call the runner's proxy, here in this process. The
    // engine sends its turn's key there, never this token.
    routeModelCallsThroughLanes(proxy.endpoint, "the in-process host's token");
    registry = stubRegistryFetch({ live: true, document: realModelRegistry(), localOrigins: [new URL(proxy.endpoint).origin] });
    resetClaudeScenarioState(env);
  });

  afterAll(async () => {
    registry.restore();
    await proxy.close();
    env.dispose();
    restoreEnv();
  });

  it("waits before the call runs, and approved, runs exactly that call once and completes under the cap", async () => {
    const ledger = join(sessionWorkspaceDir(env), "ledger.txt");
    const runs = (): number => (existsSync(ledger) ? readFileSync(ledger, "utf8").split("\n").filter((line) => line === MARKER).length : 0);
    const record = claudeExecutionRecord({
      message: `Use the Bash tool exactly once to run this command: echo ${MARKER} >> ledger.txt. Then reply with one short sentence. Do not call any other tool.`,
      modelName: LIVE_MODEL,
      maxCostUsd: MAX_COST_USD,
    });
    bindHermeticClient(record.client());

    await runClaudeInvocation(config, proxy, record);
    const seen = (): string => record.toolCalls().map((row) => `${row.name}:${ToolCallStatus[row.status]}`).join(", ");
    expect(record.persistedPhases.at(-1), `the call waits; rows: [${seen()}] ${record.lastFullStatus?.error ?? ""}`).toBe(RunPhase.RUN_WAITING_FOR_APPROVAL);
    const waiting = record.waitingToolCalls();
    expect(waiting.map((row) => row.name), `one shell call waits; rows: [${seen()}]`).toEqual(["Bash"]);
    expect(JSON.stringify(waiting[0]?.args ?? {}), "the row keeps the model's own call").toContain(MARKER);
    expect(runs(), "nothing ran while it waited").toBe(0);

    expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE, DECIDED_AT)).toBe(1);
    await runClaudeInvocation(config, proxy, record, { turnSeq: 1 });

    const final = record.lastFullStatus;
    const cost = final?.streamingUsage?.estimatedCostUsd ?? 0;
    recordLiveSpend("Claude approval round trip (claude-haiku-4.5)", cost);
    expect(record.persistedPhases.at(-1), `${final?.error ?? ""} rows: [${seen()}]`).toBe(RunPhase.RUN_COMPLETED);
    expect(runs(), "the approved call ran exactly once").toBe(1);
    const shells = record.toolCalls().filter((row) => row.name === "Bash");
    expect(shells.map((row) => [ToolCallStatus[row.status], row.approvalAction]), `rows: [${seen()}]`).toEqual([[ToolCallStatus[ToolCallStatus.TOOL_CALL_COMPLETED], ApprovalAction.APPROVE]]);
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBeLessThan(MAX_COST_USD);
  });
});
