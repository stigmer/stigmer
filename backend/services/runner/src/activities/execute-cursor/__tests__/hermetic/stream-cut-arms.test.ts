/**
 * Hermetic: a run Cursor's side cut off continues, whichever way the SDK
 * reports the cut and whichever agent it reached (stigmer#2436).
 *
 * Cursor's backend ends a long agent run's stream, the runner's lane resets
 * the SDK's stream with CANCEL, and the SDK reports it in the transport's
 * words (`CURSOR_STREAM_CUT_ERROR`, pinned against the real SDK in
 * `agent-proxy/__tests__/cursor-sdk-wire.test.ts`). The agent keeps its
 * conversation, so the turn continues on it: the activity throws the typed
 * continuation with cause `stream-cut`, nothing terminal is persisted, and
 * no fresh agent is ever made for it. The contract kit's stream-cut arm
 * pins the continuation's next invocation; this file pins the adapter's
 * paths the kit does not reach:
 *
 *  1. a resumed agent's run is cut: continued on it, never handed to the
 *     poisoned-handle recovery (which would make a fresh agent and send it
 *     the task);
 *  2. the SDK throws the cut from its stream instead: the outer catch
 *     continues it too;
 *  3. a poisoned-handle recovery's fresh agent is cut: continued on the
 *     fresh agent, which the session already names;
 *  4. a stop that came after the stream ended outranks the cut: the
 *     runtime's own evidence decides.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

vi.mock("@cursor/sdk", async () =>
  (await import("../../__test-utils__/scripted-sdk.js")).scriptedCursorSdkModule(),
);
vi.mock("@cursor/sdk/sqlite", async () =>
  (await import("../../__test-utils__/scripted-sdk.js")).scriptedCursorSqliteModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import {
  ScriptedClock,
  continuationCauseOf,
  createHermeticEnvironment,
  type HermeticEnvironment,
} from "../../../../__test-utils__/hermetic-activity.js";
import { CURSOR_STREAM_CUT_ERROR, ScriptedCursorAgent, sdkEvents, step } from "../../__test-utils__/scripted-agent.js";
import { ScriptedCursorSdkError } from "../../__test-utils__/scripted-sdk.js";
import { SDK_CATALOG, beginCursorScenario, cursorExecutionRecord, runCursorTurn } from "../../__test-utils__/hermetic-cursor.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { cutConnection } from "../../turn-settle.js";

const RESUMED_AGENT_ID = "agent-hermetic-cut-resumed";
const FRESH_AGENT_ID = "agent-hermetic-cut-fresh";
const USER_MESSAGE = "Run the migration and report what changed.";
// A transport failure the classifier files as `network`, so a resumed agent takes the poisoned-handle recovery.
const TRANSPORT_ERROR = "UNAVAILABLE: fetch failed (ECONNRESET) while streaming the run";

describe("ExecuteCursor hermetic — a run Cursor's side cut off continues", () => {
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

  it("continues a resumed agent's cut run on that agent, never on a fresh one", async () => {
    const ev = sdkEvents(RESUMED_AGENT_ID, "run-cut-resumed");
    const resumed = new ScriptedCursorAgent({
      agentId: RESUMED_AGENT_ID,
      runIds: ["run-cut-resumed"],
      turns: [[step.event(ev.init()), step.event(ev.assistant("Running the migration.")), step.errored({ error: { message: CURSOR_STREAM_CUT_ERROR } })]],
    });
    const neverMade = new ScriptedCursorAgent({ agentId: FRESH_AGENT_ID, turns: [] });
    const record = cursorExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [neverMade], resumableAgents: [resumed], catalog: SDK_CATALOG } });

    const invocation = await runCursorTurn(scenario, { threadId: RESUMED_AGENT_ID, turnSeq: 0 });

    expect(continuationCauseOf(invocation.outcome)).toBe("stream-cut");
    expect(record.persistedPhases, "nothing terminal is written").not.toContain(RunPhase.RUN_FAILED);
    expect(scenario.sdk.resolutions.map((r) => r.kind), "no fresh agent").toEqual(["resume"]);
    expect(resumed.closeCalls, "the agent keeps its conversation").toBe(0);
  });

  it("continues a cut the SDK throws from its stream", async () => {
    const agentId = "agent-hermetic-cut-thrown";
    const ev = sdkEvents(agentId, "run-cut-thrown");
    const agent = new ScriptedCursorAgent({
      agentId,
      runIds: ["run-cut-thrown"],
      turns: [
        [
          step.event(ev.init()),
          step.event(ev.assistant("Running the migration.")),
          step.effect("the SDK's stream rejects with the cut", () => {
            throw new ScriptedCursorSdkError(CURSOR_STREAM_CUT_ERROR, { code: "unknown" });
          }),
        ],
      ],
    });
    const record = cursorExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [agent], catalog: SDK_CATALOG } });

    const invocation = await runCursorTurn(scenario);

    expect(continuationCauseOf(invocation.outcome)).toBe("stream-cut");
    expect(record.persistedPhases, "nothing terminal is written").not.toContain(RunPhase.RUN_FAILED);
  });

  it("continues on the fresh agent when a poisoned-handle recovery's run is cut", async () => {
    const staleId = "agent-hermetic-cut-stale";
    const evStale = sdkEvents(staleId, "run-cut-stale");
    const evFresh = sdkEvents(FRESH_AGENT_ID, "run-cut-fresh");
    const stale = new ScriptedCursorAgent({
      agentId: staleId,
      runIds: ["run-cut-stale"],
      turns: [[step.event(evStale.init()), step.event(evStale.status("ERROR", TRANSPORT_ERROR)), step.errored({ result: TRANSPORT_ERROR })]],
    });
    const fresh = new ScriptedCursorAgent({
      agentId: FRESH_AGENT_ID,
      runIds: ["run-cut-fresh"],
      turns: [[step.event(evFresh.init()), step.event(evFresh.assistant("Running the migration.")), step.errored({ error: { message: CURSOR_STREAM_CUT_ERROR } })]],
    });
    const record = cursorExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [fresh], resumableAgents: [stale], catalog: SDK_CATALOG } });

    const invocation = await runCursorTurn(scenario, { threadId: staleId, turnSeq: 0 });

    expect(continuationCauseOf(invocation.outcome)).toBe("stream-cut");
    expect(record.persistedPhases, "nothing terminal is written").not.toContain(RunPhase.RUN_FAILED);
    expect(record.harnessBinds.at(-1)?.harnessStateId, "the continuation finds the fresh agent").toBe(FRESH_AGENT_ID);
    expect(fresh.closeCalls, "the fresh agent keeps its conversation").toBe(0);
  });

  it("leaves a cut to the runtime's evidence when its stop or yield came after the stream ended", () => {
    const stopped = new AbortController();
    stopped.abort("stop");
    const yielded = new AbortController();
    yielded.abort("drain");
    const live = new AbortController();
    expect(cutConnection({ stopSignal: stopped.signal, yieldSignal: live.signal }, "cut")).toEqual({ kind: "interrupted" });
    expect(cutConnection({ stopSignal: live.signal, yieldSignal: yielded.signal }, "cut")).toEqual({ kind: "interrupted" });
    expect(cutConnection({ stopSignal: live.signal, yieldSignal: live.signal }, "cut")).toEqual({ kind: "stream_cut", message: "cut" });
  });
});
