/**
 * Hermetic goldens: ORCHESTRATOR STOP versus WORKER SHUTDOWN — the two
 * interruptions that THROW, and what tells them apart.
 *
 * Invariant pinned (the throw-vs-return table the runtime owns,
 * `harness/terminal-table.ts`; parent §5c): both interruptions end the activity with a thrown Temporal
 * `CancelledFailure` (never a return), but they persist DIFFERENT terminal
 * states the control plane keys on:
 *
 *  - an orchestrator stop (Temporal delivers cancellation, no shutdown
 *    signal: a user's Pause or Cancel, which the turn cannot tell apart)
 *    settles the transcript in one write with NO phase and NO row, and throws
 *    "Activity paused by orchestrator" (bytes kept: wire copy). The invoke
 *    workflow, which knows which stop it runs, writes the phase and the stop
 *    row, and the server's merge keeps the row last (stigmer#980). Until then
 *    this arm wrote PAUSED and the pause row, so a cancelled run ended with an
 *    instruction to resume it;
 *  - a worker shutdown (the runner's per-queue shutdown signal is aborted AND
 *    cancellation is delivered) persists EXECUTION_FAILED with the error copy
 *    "Execution interrupted: runner worker was shut down. Retry or resume." and
 *    throws "Activity cancelled (worker shutdown, not user pause)".
 *
 * The goldens (`goldens/pause.status.json`, the stop's settle write, and
 * `goldens/worker-shutdown.status.json`) are the wire contract, character for
 * character. Both interruptions are triggered from
 * a script `effect` step — never a timer — so the instant is deterministic: the
 * stream loop sees `isCancelled()` on its next iteration and never processes
 * the event that follows.
 *
 * What the goldens ALSO pin: each path appends its system message exactly
 * ONCE. The orchestrator this net was recorded on appended it twice — once in
 * `resolvePreBoundaryTerminal` before the throw, once again in the outer
 * `catch (CancelledFailure)`, which re-stamped and re-persisted — and the
 * goldens pinned that double on purpose so #1070 could reproduce the wire byte
 * for byte (removed in stigmer#1054). The runtime's `settleWith` is now the one
 * writer of a terminal arm, so a second row has no code path to come from.
 *
 * Runtime phases exercised: the adapter's stop-signal cancel; the runtime's
 * `classifyTurnInterruption`; the terminal table's orchestrator-stop and
 * worker-shutdown arms through `settleWith`; the `finally` teardown under a
 * thrown exit.
 *
 * Regeneration history:
 *  - #1070: timestamp-only diff — every terminal stamp
 *    one scripted second earlier: the adapter cancels the SDK run the instant
 *    the runtime's stop signal aborts, before the SDK double pulls,
 *    and the clock ticks on, one more step. Transcript unchanged.
 *  - 2026-09-12 (stigmer#1054, the PR after #1070): one removed system row per
 *    golden, nothing else. The transcript now carries each terminal row once.
 *  - stigmer#980: `pause.status.json` loses its phase and its pause row (the
 *    workflow writes both now); the transcript is otherwise unchanged.
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
vi.mock("@cursor/sdk/sqlite", async () =>
  (await import("../../__test-utils__/scripted-sdk.js")).scriptedCursorSqliteModule(),
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
} from "../../__test-utils__/hermetic-cursor.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";

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

describe("ExecuteCursor hermetic — orchestrator stop vs worker shutdown", () => {
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

  it("an orchestrator stop settles the transcript with no phase and no row, and throws CancelledFailure", async () => {
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
    expect(threwCancelledFailure(invocation.outcome), "an orchestrator stop THROWS CancelledFailure").toBe(true);
    if (!threwCancelledFailure(invocation.outcome)) throw new Error("unreachable");
    expect(invocation.outcome.error.message).toBe("Activity paused by orchestrator");
    expect(record.persistedPhases, "the stop writes no phase").toEqual([ExecutionPhase.EXECUTION_IN_PROGRESS]);
    const final = record.persisted.at(-1)!;
    expect(final.phase, "the settle write carries no phase").toBe(ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED);
    expect(final.error, "a stop is not an error").toBe("");
    expect(final.completedAt, "a stopped turn is not complete").toBe("");
    expect(
      final.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM).map((m) => m.content),
      "no stop row: the workflow writes it",
    ).toEqual([]);
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
    ]);
    expect(final.messages.some((m) => m.content === NEVER_SEEN)).toBe(false);

    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/worker-shutdown.status.json");
  });
});
