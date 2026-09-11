/**
 * Hermetic goldens: USER PAUSE versus WORKER SHUTDOWN — the two interruptions
 * that THROW, and the byte-pinned copy that tells them apart.
 *
 * Invariant pinned (the throw-vs-return table the runtime will own in S2; parent
 * §5c): both interruptions end the activity with a thrown Temporal
 * `CancelledFailure` (never a return), but they persist DIFFERENT terminal
 * states the control plane keys on:
 *
 *  - a user pause (Temporal delivers cancellation, no shutdown signal) persists
 *    EXECUTION_PAUSED with "Execution paused by user. Use resume to continue."
 *    and throws "Activity paused by orchestrator";
 *  - a worker shutdown (the runner's per-queue shutdown signal is aborted AND
 *    cancellation is delivered) persists EXECUTION_FAILED with the error copy
 *    "Execution interrupted: runner worker was shut down. Retry or resume." and
 *    throws "Activity cancelled (worker shutdown, not user pause)".
 *
 * The cloud channel decision table matches on that copy, so the goldens
 * (`goldens/pause.status.json`, `goldens/worker-shutdown.status.json`) are the
 * wire contract, character for character. Both interruptions are triggered from
 * a script `effect` step — never a timer — so the instant is deterministic: the
 * stream loop sees `isCancelled()` on its next iteration and never processes
 * the event that follows.
 *
 * What the goldens ALSO pin, on purpose: both paths append their system message
 * TWICE — once in `resolvePreBoundaryTerminal` before the throw, once again in
 * the outer `catch (CancelledFailure)`, which re-stamps and re-persists. That is
 * today's production behavior on the wire. S2 must reproduce it byte for byte;
 * whether it is later collapsed to one message is a separate, deliberate change
 * (recorded in the entry's execution log for the owner).
 *
 * Parent phase rows exercised: the stream loop's cancellation check; the
 * post-stream `classifyTurnInterruption`; `resolvePreBoundaryTerminal`'s
 * pause and worker-shutdown arms; the outer `CancelledFailure` catch; the
 * `finally` teardown under a thrown exit.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-cursor/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase, MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

vi.mock("@cursor/sdk", async () =>
  (await import("../../__test-utils__/scripted-sdk.js")).scriptedCursorSdkModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import {
  ScriptedClock,
  createHermeticEnvironment,
  threwCancelledFailure,
  type HermeticEnvironment,
  type InvocationControls,
} from "../../../../__test-utils__/hermetic-activity.js";
import { ScriptedCursorAgent, sdkEvents, step } from "../../__test-utils__/scripted-agent.js";
import {
  SDK_CATALOG,
  beginCursorScenario,
  cursorExecutionRecord,
  runCursorTurn,
  stubRegistryFetch,
} from "../../__test-utils__/hermetic-cursor.js";

const USER_MESSAGE = "Refactor the parser module.";
const NEVER_SEEN = "This text must never reach the transcript.";

/**
 * A turn that is interrupted mid-stream by `interrupt(controls)`: one assistant
 * message lands, then the interruption, then an event the loop must NOT process.
 */
function interruptedTurn(
  agentId: string,
  runId: string,
  clock: ScriptedClock,
  getControls: () => InvocationControls,
  interrupt: (controls: InvocationControls) => void,
): ScriptedCursorAgent {
  const ev = sdkEvents(agentId, runId);
  return new ScriptedCursorAgent({
    agentId,
    runIds: [runId],
    observeStep: () => clock.tick(),
    turns: [
      [
        step.event(ev.init()),
        step.event(ev.assistant("Starting on the parser.")),
        step.effect("interrupt the activity from outside", () => interrupt(getControls())),
        step.event(ev.assistant(NEVER_SEEN)),
        step.finished({ result: NEVER_SEEN }),
      ],
    ],
  });
}

describe("ExecuteCursor hermetic — user pause vs worker shutdown", () => {
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

  it("a user pause persists PAUSED and throws CancelledFailure", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    clock.reset(); // both goldens read from :00
    let controls: InvocationControls | undefined;
    const agent = interruptedTurn(
      "agent-hermetic-pause-0001",
      "run-hermetic-pause-0001",
      clock,
      () => controls!,
      (c) => c.cancel(),
    );
    const record = cursorExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [agent], catalog: SDK_CATALOG } });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runCursorTurn(scenario, { onControls: (c) => (controls = c) });

    // ── Assert: the throw and the persisted state ────────────────────────────
    expect(threwCancelledFailure(invocation.outcome), "a pause THROWS CancelledFailure").toBe(true);
    if (!threwCancelledFailure(invocation.outcome)) throw new Error("unreachable");
    expect(invocation.outcome.error.message).toBe("Activity paused by orchestrator");
    expect(record.persistedPhases).toEqual([
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_PAUSED,
    ]);
    const final = record.lastFullStatus!;
    expect(final.error, "a pause is not an error").toBe("");
    expect(final.completedAt, "a paused turn is not complete").toBe("");
    expect(
      final.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM).map((m) => m.content),
    ).toEqual([
      "Execution paused by user. Use resume to continue.",
      "Execution paused by user. Use resume to continue.",
    ]);
    expect(final.messages.some((m) => m.content === NEVER_SEEN), "nothing after the cancel is processed").toBe(false);

    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/pause.status.json");
  });

  it("a worker shutdown persists FAILED with the shutdown copy and throws CancelledFailure", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    clock.reset();
    let controls: InvocationControls | undefined;
    const agent = interruptedTurn(
      "agent-hermetic-shutdown-0001",
      "run-hermetic-shutdown-0001",
      clock,
      () => controls!,
      (c) => {
        // The runner-manager drains: the queue's shutdown signal aborts, then
        // Temporal delivers the cancellation.
        c.signalWorkerShutdown();
        c.cancel();
      },
    );
    const record = cursorExecutionRecord({ message: USER_MESSAGE });
    const scenario = beginCursorScenario({ env, clock, record, sdk: { agents: [agent], catalog: SDK_CATALOG } });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runCursorTurn(scenario, { onControls: (c) => (controls = c) });

    // ── Assert: the throw and the persisted state ────────────────────────────
    expect(threwCancelledFailure(invocation.outcome), "a shutdown THROWS CancelledFailure").toBe(true);
    if (!threwCancelledFailure(invocation.outcome)) throw new Error("unreachable");
    expect(invocation.outcome.error.message).toBe("Activity cancelled (worker shutdown, not user pause)");
    expect(record.persistedPhases).toEqual([
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_FAILED,
    ]);
    const final = record.lastFullStatus!;
    expect(final.error).toBe("Execution interrupted: runner worker was shut down. Retry or resume.");
    expect(final.completedAt).not.toBe("");
    expect(
      final.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM).map((m) => m.content),
    ).toEqual([
      "Execution interrupted: the runner worker was shut down while the agent was still running. You can retry or resume.",
      "Execution interrupted: the runner worker was shut down while the agent was still running. You can retry or resume.",
    ]);
    expect(final.messages.some((m) => m.content === NEVER_SEEN)).toBe(false);

    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/worker-shutdown.status.json");
  });
});
