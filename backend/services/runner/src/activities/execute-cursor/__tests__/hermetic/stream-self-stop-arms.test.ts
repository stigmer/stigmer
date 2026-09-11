/**
 * Hermetic goldens: the three arms where the STREAM LOOP STOPS ITSELF and the
 * activity RETURNS a terminal status — a stall, a cost cap, a platform stop.
 *
 * `resolvePreBoundaryTerminal` (index.ts) reads the flags the stream loop
 * raised and maps each to a phase, a copy, an engine disposition and a
 * throw-vs-return decision. The two THROW arms (user pause, worker shutdown)
 * are `pause-vs-shutdown.test.ts`; these are the three RETURN arms, side by
 * side because they differ in every column of that table:
 *
 *  | arm           | phase      | run.cancel() | agent handle |
 *  |---------------|------------|--------------|--------------|
 *  | stall         | FAILED     | yes          | parked       |
 *  | cost cap      | TERMINATED | yes          | parked       |
 *  | platform stop | COMPLETED  | yes          | parked       |
 *
 * All three RETURN because a Temporal retry would re-run the identical prompt:
 * a wedged agent would wedge again, an exhausted budget would be burnt again,
 * a platform stop is the platform's decision.
 *
 * How each is triggered without a timer or a sleep:
 *  - STALL: the stall watchdog measures idle time with `Date.now()`, which the
 *    scripted clock fakes and only the script advances. An `effect` step ticks
 *    the clock past the stall window, then awaits the watchdog's own
 *    `run.cancel()` (the run's status flips to `cancelled`). The watchdog's
 *    poll interval is real (stallMs / 4), so the wait is sub-second and the
 *    reported idle seconds are exact.
 *  - COST CAP: a `turn-ended` usage delta prices above `max_cost_usd` on the
 *    fixture registry's round numbers; the loop breaks at the NEXT event.
 *  - PLATFORM STOP: the control plane answers STOP (`ExecutionRecord.controlSignal`)
 *    to the mid-stream persist that carries a COMPLETED tool call. That persist
 *    is the one point a scenario can rely on: the streaming scheduler paces
 *    persists on `performance.now()` — REAL time, not the scripted clock — so
 *    after its first-event update a text-only event persists only if 500 ms
 *    of wall time have passed, while a tool-call transition force-flushes
 *    (`contentDirty`) whatever the clock says.
 *
 * Engine disposition and cancellation since S2 M3 (entry 20260911.03): the
 * adapter cancels the SDK run on EVERY stop (Q-M3-4; before, a platform stop
 * broke the loop and left the run executing) and parks the handle on every
 * non-failed exit (Q-S2-6; before, a stall dropped it — the adapter cannot
 * tell a stall from a cost cap, and a wedged parked handle is caught by the
 * poisoned-handle recovery on the next turn). The two assertions that moved
 * say so on their line. The cost-cap golden was regenerated at M3b with a
 * timestamp-only diff (every terminal stamp one scripted second earlier):
 * the run is now cancelled the instant the signal aborts, before the SDK
 * double pulls — and the clock ticks on — one more step.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-cursor/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ExecutionControlSignal,
  ExecutionPhase,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

vi.mock("@cursor/sdk", async () =>
  (await import("../../__test-utils__/scripted-sdk.js")).scriptedCursorSdkModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import {
  ScriptedClock,
  createHermeticEnvironment,
  type HermeticEnvironment,
} from "../../../../__test-utils__/hermetic-activity.js";
import { _parkedAgentCountForTests } from "../../agent-session-cache.js";
import { ScriptedCursorAgent, sdkEvents, step, type ScriptedRun } from "../../__test-utils__/scripted-agent.js";
import {
  SDK_CATALOG,
  beginCursorScenario,
  cursorExecutionRecord,
  runCursorTurn,
} from "../../__test-utils__/hermetic-cursor.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";

const USER_MESSAGE = "Run the full test suite and report.";
const NEVER_SEEN = "This text must never reach the transcript.";

/**
 * The stall window for the stall scenario. Above the clock's 1 s step tick
 * (so no ordinary step can read as idle) and small enough that the watchdog's
 * real poll (stallMs / 4 = 500 ms) fires promptly once the script ticks past it.
 */
const STALL_TIMEOUT_MS = 2_000;

/** Resolves when the run's status flips to `cancelled` — the watchdog's act. */
function untilCancelled(run: ScriptedRun): Promise<void> {
  return new Promise((resolve) => {
    run.onDidChangeStatus((status) => {
      if (status === "cancelled") resolve();
    });
  });
}

function systemMessages(status: { messages: { type: MessageType; content: string }[] }): string[] {
  return status.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM).map((m) => m.content);
}

describe("ExecuteCursor hermetic — the stream loop's self-stop arms", () => {
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

  it("a stall fails the turn with the watchdog's idle time and drops the handle", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    clock.reset(); // every golden in this file reads from :00
    const agentId = "agent-hermetic-stall-0001";
    const runId = "run-hermetic-stall-0001";
    const ev = sdkEvents(agentId, runId);
    const agent = new ScriptedCursorAgent({
      agentId,
      runIds: [runId],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev.init()),
          step.event(ev.assistant("Running the suite.")),
          // A tool call that never returns: the shape of a real wedge, and the
          // detail the stall copy carries (`last tool: shell`).
          step.event(ev.toolCall("call-hermetic-stall-0001", "shell", "running", { command: "npm test" })),
          step.effect("the stream goes silent past the stall window", async ({ run }) => {
            const cancelled = untilCancelled(run);
            clock.tick(STALL_TIMEOUT_MS);
            await cancelled;
          }),
          step.event(ev.assistant(NEVER_SEEN)),
          step.finished({ result: NEVER_SEEN }),
        ],
      ],
    });
    const record = cursorExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginCursorScenario({
      env,
      clock,
      record,
      sdk: { agents: [agent], catalog: SDK_CATALOG },
      config: { cursorStreamStallTimeoutMs: STALL_TIMEOUT_MS },
    });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runCursorTurn(scenario);

    // ── Assert: outcome and phases ───────────────────────────────────────────
    expect(invocation.outcome.kind, "a stall RETURNS, never throws — a retry would wedge again").toBe("returned");
    const slim = (invocation.outcome as { value: Record<string, unknown> }).value;
    expect(slim.phase).toBe("EXECUTION_FAILED");
    expect(record.persistedPhases).toEqual([
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_FAILED,
    ]);
    const final = record.lastFullStatus!;
    // Idle = the 1 s step tick before the effect + the effect's own tick: 3 s.
    expect(final.error).toBe(
      "[StallTimeoutError] Agent stream stalled: no activity for 3s (last tool: shell). Retry or resume.",
    );
    expect(final.completedAt).not.toBe("");
    expect(systemMessages(final)).toEqual([
      "Execution failed: the agent made no progress for too long and was stopped " +
        "(Agent stream stalled: no activity for 3s (last tool: shell)). You can retry or resume.",
    ]);
    expect(final.messages.some((m) => m.content === NEVER_SEEN), "nothing after the stall is processed").toBe(false);

    // ── Assert: engine disposition ───────────────────────────────────────────
    expect(agent.runs[0].cancelCalls, "the runtime's stop cancelled the run once").toHaveLength(1);
    expect(agent.closeCalls, "the handle is not closed").toBe(0);
    // Q-S2-6 (S2 M3): parked on every non-failed exit; before M3 a stall dropped it.
    expect(_parkedAgentCountForTests(), "parked for the session's next turn").toBe(1);
    expect(record.sessionUpdates).toHaveLength(1);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
    expect(invocation.heartbeats.length).toBeGreaterThan(0);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/stall.status.json");
  });

  it("a cost cap terminates the turn with the budget copy and parks the agent", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    clock.reset();
    const agentId = "agent-hermetic-costcap-0001";
    const runId = "run-hermetic-costcap-0001";
    const ev = sdkEvents(agentId, runId);
    const agent = new ScriptedCursorAgent({
      agentId,
      runIds: [runId],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev.init()),
          step.event(ev.assistant("Reading the whole repository first.")),
          // 600 000 input tokens at the fixture's $1/M base rate = $0.60 > $0.50.
          step.turnEnded({ inputTokens: 600_000, outputTokens: 0 }),
          step.event(ev.assistant(NEVER_SEEN)),
          step.finished({ result: NEVER_SEEN }),
        ],
      ],
    });
    const record = cursorExecutionRecord({ message: USER_MESSAGE, maxCostUsd: 0.5 });
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [agent], catalog: SDK_CATALOG } });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runCursorTurn(scenario);

    // ── Assert: outcome and phases ───────────────────────────────────────────
    expect(invocation.outcome.kind, "a cost cap RETURNS — a retry would burn the budget again").toBe("returned");
    const slim = (invocation.outcome as { value: Record<string, unknown> }).value;
    expect(slim.phase).toBe("EXECUTION_TERMINATED");
    expect(record.persistedPhases).toEqual([
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_TERMINATED,
    ]);
    const final = record.lastFullStatus!;
    expect(final.error).toBe(
      "Agent reached the cost limit for this message (~$0.6000 of the $0.50 budget). Send another message to continue.",
    );
    expect(final.completedAt).not.toBe("");
    expect(systemMessages(final)).toEqual([
      "The agent reached the cost limit for this message. Work completed so far has been saved. " +
        "Send another message to continue where the agent left off.",
    ]);
    expect(final.streamingUsage?.estimatedCostUsd, "the figure the copy quotes is the usage summary's").toBe(0.6);
    expect(final.messages.some((m) => m.content === NEVER_SEEN), "the event after the overrun is never processed").toBe(false);

    // ── Assert: engine disposition ───────────────────────────────────────────
    expect(agent.runs[0].cancelCalls, "the runtime's stop cancelled the run once").toHaveLength(1);
    expect(agent.closeCalls).toBe(0);
    expect(_parkedAgentCountForTests(), "a clean terminal parks for the next message").toBe(1);
    expect(record.sessionUpdates).toHaveLength(1);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/cost-cap.status.json");
  });

  it("a platform stop completes the turn early with the platform copy and parks the agent", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    clock.reset();
    const agentId = "agent-hermetic-platformstop-0001";
    const runId = "run-hermetic-platformstop-0001";
    const ev = sdkEvents(agentId, runId);
    const agent = new ScriptedCursorAgent({
      agentId,
      runIds: [runId],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev.init()),
          step.event(ev.assistant("Starting the suite.")),
          // A completed tool call force-flushes a persist (content dirty); the
          // control plane answers THAT persist with STOP.
          step.event(ev.toolCall("call-hermetic-platformstop-0001", "read", "running", { path: "package.json" })),
          step.event(
            ev.toolCall("call-hermetic-platformstop-0001", "read", "completed", { path: "package.json" }, '{"name":"demo"}'),
          ),
          step.event(ev.assistant(NEVER_SEEN)),
          step.finished({ result: NEVER_SEEN }),
        ],
      ],
    });
    const record = cursorExecutionRecord({
      message: USER_MESSAGE,
      // The platform's decision: stop once the tool call has completed.
      controlSignal: (status) =>
        status.messages.some((m) => m.toolCalls.some((tc) => tc.status === ToolCallStatus.TOOL_CALL_COMPLETED))
          ? ExecutionControlSignal.STOP
          : ExecutionControlSignal.UNSPECIFIED,
    });
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [agent], catalog: SDK_CATALOG } });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runCursorTurn(scenario);

    // ── Assert: outcome and phases ───────────────────────────────────────────
    expect(invocation.outcome.kind, "a platform stop RETURNS a clean completion").toBe("returned");
    const slim = (invocation.outcome as { value: Record<string, unknown> }).value;
    expect(slim.phase).toBe("EXECUTION_COMPLETED");
    expect(record.persistedPhases).toEqual([
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_COMPLETED,
    ]);
    const final = record.lastFullStatus!;
    expect(final.error, "a platform stop is not an error").toBe("");
    expect(final.completedAt).not.toBe("");
    expect(systemMessages(final)).toEqual(["Execution stopped by the platform."]);
    expect(record.toolCalls().map((tc) => tc.status), "the persist that drew the STOP is on the transcript").toEqual([
      ToolCallStatus.TOOL_CALL_COMPLETED,
    ]);
    expect(final.messages.some((m) => m.content === NEVER_SEEN), "the event after the STOP is never processed").toBe(false);

    // ── Assert: engine disposition ───────────────────────────────────────────
    // Q-M3-4 (S2 M3): the SDK run is cancelled on every stop; before M3 a
    // platform stop broke the loop and left the run executing behind the
    // parked handle.
    expect(agent.runs[0].cancelCalls, "the runtime's stop cancelled the run once").toHaveLength(1);
    expect(agent.closeCalls).toBe(0);
    expect(_parkedAgentCountForTests(), "a clean terminal parks for the next message").toBe(1);
    expect(record.sessionUpdates).toHaveLength(1);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/platform-stop.status.json");
  });
});
