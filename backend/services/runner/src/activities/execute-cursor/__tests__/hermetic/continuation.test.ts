/**
 * Hermetic: a Cursor turn drained by its runner continues on the next one,
 * and its agent is never handed the task twice (stigmer#2417).
 *
 * Invariant pinned: the second invocation of a drained run is a
 * continuation (`TurnInput.continuation`, carrying the digest of what the
 * run wrote), and the prompt it sends depends on which agent it gets:
 *
 *  - the agent that held the run, resumed on the new runner: a continuation
 *    prompt (`<turn_continuation>`, the digest, never the task), sent with
 *    `local.force` so the SDK expires the run the drained process left
 *    active;
 *  - a fresh agent, because the old one could not be resumed: the task, once,
 *    with the digest (`<turn_recovery>`), because that context never held it.
 *
 * The drain lands from a script `effect` step, never a timer. Each
 * invocation's scenario is a new runner over the same record: its own SDK
 * double, so what the new runner can resume is exactly what it declares.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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
  type ExecutionRecord,
  type HermeticEnvironment,
  type InvocationControls,
} from "../../../../__test-utils__/hermetic-activity.js";
import { ScriptedCursorAgent, sdkEvents, step, type ScriptStep } from "../../__test-utils__/scripted-agent.js";
import { FIXTURE, SDK_CATALOG, beginCursorScenario, cursorExecutionRecord, runCursorTurn } from "../../__test-utils__/hermetic-cursor.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";

const USER_MESSAGE = "Refactor the parser module.";
const BEFORE_THE_DRAIN = "Starting on the parser.";
const NEVER_SEEN = "This text must never reach the transcript.";
const FINAL_TEXT = "The parser is refactored.";

/** The drained invocation: one message, then the runner drains, then an event the loop must not process. */
function drainedTurn(agentId: string, runId: string, getControls: () => InvocationControls): ScriptStep[] {
  const ev = sdkEvents(agentId, runId);
  return [
    step.event(ev.init()),
    step.event(ev.assistant(BEFORE_THE_DRAIN)),
    step.effect("the runner drains", () => getControls().signalWorkerShutdown()),
    step.event(ev.assistant(NEVER_SEEN)),
    step.finished({ result: NEVER_SEEN }),
  ];
}

/** The invocation that picks the turn up and finishes it. */
function finishingTurn(agentId: string, runId: string): ScriptStep[] {
  const ev = sdkEvents(agentId, runId);
  return [
    step.event(ev.assistant(FINAL_TEXT)),
    step.turnEnded({ inputTokens: 1_200, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 }),
    step.finished({ result: FINAL_TEXT, model: { id: FIXTURE.model, params: [] } }),
  ];
}

describe("ExecuteCursor hermetic — a drained turn continues without the task", () => {
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

  /** Run the drained first invocation on `agent`, created fresh; returns the record to continue. */
  async function drainFirstInvocation(agent: ScriptedCursorAgent, controls: { current?: InvocationControls }): Promise<ExecutionRecord> {
    const record = cursorExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [agent], catalog: SDK_CATALOG } });
    const first = await runCursorTurn(scenario, { onControls: (c) => (controls.current = c) });
    expect(continuationCauseOf(first.outcome), "the drained invocation continues").toBe("drain");
    expect(agent.sends, "the first invocation hands the agent the task").toHaveLength(1);
    expect(String(agent.sends[0]!.message)).toContain(USER_MESSAGE);
    return record;
  }

  it("resumes the agent that held the run with a continuation prompt and force, never the task", async () => {
    clock.reset();
    const agentId = "agent-hermetic-continue-0001";
    const controls: { current?: InvocationControls } = {};
    const agent = new ScriptedCursorAgent({
      agentId,
      runIds: ["run-hermetic-continue-0001", "run-hermetic-continue-0002"],
      observeStep: () => clock.tick(),
      turns: [drainedTurn(agentId, "run-hermetic-continue-0001", () => controls.current!), finishingTurn(agentId, "run-hermetic-continue-0002")],
    });
    const record = await drainFirstInvocation(agent, controls);

    // The next runner: it can resume the agent from the SDK's store.
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [], resumableAgents: [agent], catalog: SDK_CATALOG } });
    const second = await runCursorTurn(scenario, { threadId: agentId });

    expect(second.outcome.kind).toBe("returned");
    expect((second.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
    expect(scenario.sdk.resolutions.map((r) => [r.kind, r.agentId])).toEqual([["resume", agentId]]);
    expect(agent.sends, "one send per invocation").toHaveLength(2);
    const continued = String(agent.sends[1]!.message);
    expect(continued).toContain("<turn_continuation>");
    expect(continued, "the continuation carries what the run already said").toContain(BEFORE_THE_DRAIN);
    expect(continued, "the resumed agent is never handed the task again").not.toContain(USER_MESSAGE);
    expect(agent.sends[1]!.force, "the send expires the run the drained process left active").toBe(true);
    expect(agent.sends[0]!.force, "a first send forces nothing").toBe(false);
  });

  it("hands a fresh agent the task once, with the digest, when the held agent cannot be resumed", async () => {
    clock.reset();
    const heldId = "agent-hermetic-continue-held-0001";
    const freshId = "agent-hermetic-continue-fresh-0002";
    const controls: { current?: InvocationControls } = {};
    const held = new ScriptedCursorAgent({
      agentId: heldId,
      runIds: ["run-hermetic-continue-held-0001"],
      observeStep: () => clock.tick(),
      turns: [drainedTurn(heldId, "run-hermetic-continue-held-0001", () => controls.current!)],
    });
    const fresh = new ScriptedCursorAgent({
      agentId: freshId,
      runIds: ["run-hermetic-continue-fresh-0001"],
      observeStep: () => clock.tick(),
      turns: [finishingTurn(freshId, "run-hermetic-continue-fresh-0001")],
    });
    const record = await drainFirstInvocation(held, controls);

    // The next runner cannot resume the held agent; it creates a fresh one.
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [fresh], catalog: SDK_CATALOG } });
    const second = await runCursorTurn(scenario, { threadId: heldId });

    expect((second.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
    expect(scenario.sdk.resolutions.at(-1)?.kind).toBe("create");
    expect(fresh.sends, "the fresh agent ran the turn once").toHaveLength(1);
    const recovery = String(fresh.sends[0]!.message);
    expect(recovery.split(USER_MESSAGE).length - 1, "a context that never held the task is handed it once").toBe(1);
    expect(recovery).toContain("<turn_recovery>");
    expect(recovery, "with what the run already did").toContain(BEFORE_THE_DRAIN);
    expect(fresh.sends[0]!.force, "a fresh agent has no active run to expire").toBe(false);
  });
});
