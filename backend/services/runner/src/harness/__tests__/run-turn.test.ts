/**
 * The turn runtime, proven without any engine: the scripted fake adapter
 * (`__test-utils__/harness-contract/scripted-adapter.ts`) through
 * `createHarnessActivities` under `MockActivityEnvironment`, one scenario per
 * arm of the terminal table, the copy asserted verbatim against the
 * constants the goldens pin.
 *
 * This is the runtime-side half of the harness contract (the kit's adapter
 * side is `harness-contract/contract.ts`): the throw-vs-return rule end to
 * end, the single persist chokepoint, the whole-activity heartbeat, the
 * stop controller's four producers, the reinvocation seam. Every scenario
 * here has a twin among the Cursor hermetic goldens
 * (`activities/execute-cursor/__tests__/hermetic/`), which is what lets the
 * two be compared when the Cursor adapter moves onto this runtime: an arm
 * that differs between the fake and the real engine is an adapter defect,
 * not a runtime one.
 *
 * How each arm is provoked without a timer or a sleep: a `hang` step parks
 * the fake on the stop signal and the fake reports it (`whenHanging`), which
 * is when the test delivers the cancellation, the drain, or the clock tick
 * that trips the stall watchdog (the watchdog measures idle time with
 * `Date.now()`, which the scripted clock owns; its poll is real and
 * sub-second at the window used here).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdirSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { ApprovalAction, ExecutionPhase, MessageType, ExecutionControlSignal } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

vi.mock("../../client/stigmer-client.js", async () =>
  (await import("../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import type { StigmerClient } from "../../client/stigmer-client.js";
import type { Config } from "../../config.js";
import type { ExecuteActivityInput } from "../../shared/activity-input.js";
import { acquireWorkspaceLock } from "../../shared/workspace/workspace-lock.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";
import { executionRecordFixture, type ExecutionRecordOptions } from "../../__test-utils__/execution-record-fixture.js";
import {
  ScriptedClock,
  bindHermeticClient,
  createHermeticEnvironment,
  runActivityHermetically,
  threwCancelledFailure,
  type ActivityInvocation,
  type ExecutionRecord,
  type HermeticEnvironment,
  type InvocationControls,
} from "../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../__test-utils__/model-registry-fixture.js";
import { ScriptedHarnessAdapter } from "../../__test-utils__/harness-contract/scripted-adapter.js";
import { scenario, type TurnScenario } from "../../__test-utils__/harness-contract/types.js";
import { createHarnessActivities } from "../registry.js";
import { TERMINAL_COPY } from "../terminal-table.js";

const USER_MESSAGE = "Summarize the repository.";
const NEVER_SEEN = "This text must never reach the transcript.";
const TASK_QUEUE = "runtime-test-queue";
/** Above the clock's 1 s step and small enough that the watchdog's real poll (stallMs / 4) fires promptly. */
const STALL_TIMEOUT_MS = 2_000;

/** The runtime's own resolution labels, in order; a harness's setup labels follow them. */
const RUNTIME_SETUP_LABELS = [
  "Fetching execution",
  "Resolving agent blueprint",
  "Resolving environment",
  "Provisioning workspace",
  "Resolving MCP servers",
];

function systemMessages(status: { messages: { type: MessageType; content: string }[] }): string[] {
  return status.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM).map((m) => m.content);
}

function aiMessages(status: { messages: { type: MessageType; content: string }[] }): string[] {
  return status.messages.filter((m) => m.type === MessageType.MESSAGE_AI).map((m) => m.content);
}

interface RuntimeTurnOptions {
  readonly record: ExecutionRecord;
  readonly adapter: ScriptedHarnessAdapter;
  readonly config: Config;
  readonly clientOverrides?: Partial<StigmerClient>;
  readonly threadId?: string;
  readonly turnSeq?: number;
  readonly onControls?: (controls: InvocationControls) => void;
}

/** One activity invocation of the fake through the real runtime; the runtime's activity is built per call, as the driver does. */
async function runRuntimeTurn(options: RuntimeTurnOptions): Promise<ActivityInvocation> {
  bindHermeticClient(options.record.client(options.clientOverrides));
  const activities = createHarnessActivities([{ harness: "deep-agent", adapter: options.adapter }], options.config);
  const input: ExecuteActivityInput = {
    execution_id: options.record.executionId,
    thread_id: options.threadId ?? "",
    turn_seq: options.turnSeq ?? 0,
  };
  return runActivityHermetically(activities.ExecuteDeepAgent!, [input], {
    taskQueue: TASK_QUEUE,
    onControls: options.onControls,
  });
}

function fakeAdapter(turns: readonly TurnScenario[]): ScriptedHarnessAdapter {
  const adapter = new ScriptedHarnessAdapter({ pausePrimitive: "interrupt", stateIdSource: "engine-minted" });
  for (const turn of turns) adapter.arrange(turn);
  return adapter;
}

function slimOf(invocation: ActivityInvocation): Record<string, unknown> {
  expect(invocation.outcome.kind).toBe("returned");
  return (invocation.outcome as { value: Record<string, unknown> }).value;
}

describe("run-turn: the fake adapter through the real runtime", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  let config: Config;
  const clock = new ScriptedClock();

  beforeAll(() => {
    env = createHermeticEnvironment();
    registry = stubRegistryFetch();
    clock.install();
    config = testConfig({ workspaceRootDir: env.workspaceRootDir, taskQueue: TASK_QUEUE });
  });

  afterAll(() => {
    clock.uninstall();
    registry.restore();
    env.dispose();
  });

  const record = (options: Partial<ExecutionRecordOptions> = {}): ExecutionRecord =>
    executionRecordFixture({ message: USER_MESSAGE, ...options });

  it("a completed turn: the runtime's labels, one bind, the transcript, the slim return with final_text", async () => {
    clock.reset();
    const adapter = fakeAdapter([[scenario.say("The repository has three packages."), scenario.usage({ inputTokens: 1_200, outputTokens: 40, estimatedCostUsd: 0.00136, model: "fixture-model", requestedModelParams: "" })]]);
    const rec = record();

    const invocation = await runRuntimeTurn({ record: rec, adapter, config });

    const slim = slimOf(invocation);
    expect(slim.phase).toBe("EXECUTION_COMPLETED");
    expect(slim.final_text).toBe("The repository has three packages.");
    expect(slim).not.toHaveProperty("messages");
    expect(rec.persistedPhases).toEqual([ExecutionPhase.EXECUTION_IN_PROGRESS, ExecutionPhase.EXECUTION_COMPLETED]);
    expect(rec.setupProgress).toEqual(RUNTIME_SETUP_LABELS);
    expect(rec.sessionUpdates, "an engine-minted adapter binds once").toHaveLength(1);
    expect(rec.sessionUpdates[0]?.spec?.harnessStateId, "the id the fake minted").toBeTruthy();
    const final = rec.lastFullStatus!;
    expect(final.completedAt).not.toBe("");
    expect(final.error).toBe("");
    expect(final.streamingUsage?.estimatedCostUsd, "the summary is the adapter's stated price, summed").toBeCloseTo(0.00136, 9);
    expect(final.streamingUsage?.model, "the basis the adapter named").toBe("fixture-model");
    expect(invocation.heartbeats.length, "the whole-activity heartbeat pulsed").toBeGreaterThan(0);
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);
  });

  it("awaiting_approval then APPROVE: the WAITING row, the reinvocation by the bound id, one execution, COMPLETED", async () => {
    clock.reset();
    const propose = scenario.propose("call-runtime-0001", { kind: "write", resource: "/work/alpha.txt" });
    const adapter = fakeAdapter([[propose], [propose, scenario.say("Done.")]]);
    const rec = record();

    const first = await runRuntimeTurn({ record: rec, adapter, config });
    expect(slimOf(first).phase).toBe("EXECUTION_WAITING_FOR_APPROVAL");
    // The fake proposes without streaming first, so the WAITING write is the
    // turn's first full persist (a real engine's streaming persists precede it).
    expect(rec.persistedPhases).toEqual([ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL]);
    expect(rec.waitingToolCalls().map((tc) => tc.id)).toEqual(["call-runtime-0001"]);
    expect(adapter.executionCount("call-runtime-0001"), "a proposal never executes in its own turn").toBe(0);
    const boundId = rec.sessionUpdates.at(-1)?.spec?.harnessStateId;
    expect(boundId).toBeTruthy();

    clock.tick();
    expect(rec.decideWaitingToolCalls(ApprovalAction.APPROVE, new Date().toISOString())).toBe(1);

    const second = await runRuntimeTurn({ record: rec, adapter, config, threadId: boundId, turnSeq: 1 });
    expect(slimOf(second).phase).toBe("EXECUTION_COMPLETED");
    expect(slimOf(second).final_text).toBe("Done.");
    expect(adapter.executionCount("call-runtime-0001"), "APPROVE executes exactly once").toBe(1);
    expect(rec.persistedPhases).toEqual([
      ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      ExecutionPhase.EXECUTION_IN_PROGRESS,
      ExecutionPhase.EXECUTION_COMPLETED,
    ]);
    expect(rec.waitingToolCalls()).toHaveLength(0);
    expect(rec.sessionUpdates, "a resumed engine binds nothing new").toHaveLength(1);
  });

  it("REJECT of an irreversible action settles the reinvocation FAILED before any engine runs", async () => {
    clock.reset();
    const propose = scenario.propose("call-runtime-0002", { kind: "shell", resource: "rm -rf build" });
    const adapter = fakeAdapter([[propose], [scenario.say(NEVER_SEEN)]]);
    const rec = record();

    const first = await runRuntimeTurn({ record: rec, adapter, config });
    const boundId = rec.sessionUpdates.at(-1)?.spec?.harnessStateId;
    expect(slimOf(first).phase).toBe("EXECUTION_WAITING_FOR_APPROVAL");
    clock.tick();
    rec.decideWaitingToolCalls(ApprovalAction.REJECT, new Date().toISOString());

    const second = await runRuntimeTurn({ record: rec, adapter, config, threadId: boundId, turnSeq: 1 });
    expect(slimOf(second).phase).toBe("EXECUTION_FAILED");
    const final = rec.lastFullStatus!;
    expect(final.error).toBe(TERMINAL_COPY.rejectedByUser.error);
    expect(systemMessages(final).at(-1)).toBe(TERMINAL_COPY.rejectedByUser.row);
    expect(final.completedAt).not.toBe("");
    expect(aiMessages(final)).not.toContain(NEVER_SEEN);
  });

  it("a user pause persists PAUSED (the #1054 double) and throws the pause CancelledFailure", async () => {
    clock.reset();
    const adapter = fakeAdapter([[scenario.say("Starting on the parser."), scenario.hang(), scenario.say(NEVER_SEEN)]]);
    const rec = record();
    let controls: InvocationControls | undefined;
    void adapter.whenHanging().then(() => controls!.cancel());

    const invocation = await runRuntimeTurn({ record: rec, adapter, config, onControls: (c) => (controls = c) });

    expect(threwCancelledFailure(invocation.outcome)).toBe(true);
    if (!threwCancelledFailure(invocation.outcome)) throw new Error("unreachable");
    expect(invocation.outcome.error.message).toBe(TERMINAL_COPY.pause.throwMessage);
    expect(rec.persistedPhases).toEqual([ExecutionPhase.EXECUTION_IN_PROGRESS, ExecutionPhase.EXECUTION_PAUSED]);
    const final = rec.lastFullStatus!;
    expect(final.error, "a pause is not an error").toBe("");
    expect(final.completedAt, "a paused turn is not complete").toBe("");
    expect(systemMessages(final)).toEqual([TERMINAL_COPY.pause.row, TERMINAL_COPY.pause.row]);
    expect(aiMessages(final)).not.toContain(NEVER_SEEN);
  });

  it("a worker shutdown persists FAILED with the shutdown copy (doubled) and throws the shutdown CancelledFailure", async () => {
    clock.reset();
    const adapter = fakeAdapter([[scenario.say("Starting on the parser."), scenario.hang(), scenario.say(NEVER_SEEN)]]);
    const rec = record();
    let controls: InvocationControls | undefined;
    void adapter.whenHanging().then(() => {
      // The runner-manager drains: the queue's shutdown signal aborts, then
      // Temporal delivers the cancellation.
      controls!.signalWorkerShutdown();
      controls!.cancel();
    });

    const invocation = await runRuntimeTurn({ record: rec, adapter, config, onControls: (c) => (controls = c) });

    expect(threwCancelledFailure(invocation.outcome)).toBe(true);
    if (!threwCancelledFailure(invocation.outcome)) throw new Error("unreachable");
    expect(invocation.outcome.error.message).toBe(TERMINAL_COPY.workerShutdown.throwMessage);
    expect(rec.persistedPhases).toEqual([ExecutionPhase.EXECUTION_IN_PROGRESS, ExecutionPhase.EXECUTION_FAILED]);
    const final = rec.lastFullStatus!;
    expect(final.error).toBe(TERMINAL_COPY.workerShutdown.error);
    expect(final.completedAt).not.toBe("");
    expect(systemMessages(final)).toEqual([TERMINAL_COPY.workerShutdown.row, TERMINAL_COPY.workerShutdown.row]);
  });

  it("a stall fails the turn with the watchdog's idle time; the copy names the last activity detail", async () => {
    clock.reset();
    const adapter = fakeAdapter([[scenario.say("Running the suite."), scenario.hang(), scenario.say(NEVER_SEEN)]]);
    const rec = record();
    void adapter.whenHanging().then(() => clock.tick(STALL_TIMEOUT_MS));

    const invocation = await runRuntimeTurn({
      record: rec,
      adapter,
      config: { ...config, cursorStreamStallTimeoutMs: STALL_TIMEOUT_MS },
    });

    expect(slimOf(invocation).phase, "a stall RETURNS — a retry would wedge again").toBe("EXECUTION_FAILED");
    expect(rec.persistedPhases).toEqual([ExecutionPhase.EXECUTION_IN_PROGRESS, ExecutionPhase.EXECUTION_FAILED]);
    const final = rec.lastFullStatus!;
    expect(final.error).toMatch(/^\[StallTimeoutError\] Agent stream stalled: no activity for \d+s\. Retry or resume\.$/);
    expect(systemMessages(final)).toHaveLength(1);
    expect(systemMessages(final)[0]).toMatch(
      /^Execution failed: the agent made no progress for too long and was stopped \(Agent stream stalled: no activity for \d+s\)\. You can retry or resume\.$/,
    );
    expect(final.completedAt).not.toBe("");
    expect(aiMessages(final)).not.toContain(NEVER_SEEN);
  });

  it("a cost cap terminates the turn with the budget copy; the event after the overrun is never processed", async () => {
    clock.reset();
    const adapter = fakeAdapter([
      [
        scenario.say("Reading the whole repository first."),
        // 600 000 input tokens priced by the adapter at $0.60 > the $0.50 budget.
        scenario.usage({ inputTokens: 600_000, outputTokens: 0, estimatedCostUsd: 0.6, model: "fixture-model" }),
        scenario.say(NEVER_SEEN),
      ],
    ]);
    const rec = record({ maxCostUsd: 0.5 });

    const invocation = await runRuntimeTurn({ record: rec, adapter, config });

    expect(slimOf(invocation).phase).toBe("EXECUTION_TERMINATED");
    expect(rec.persistedPhases).toEqual([ExecutionPhase.EXECUTION_IN_PROGRESS, ExecutionPhase.EXECUTION_TERMINATED]);
    const final = rec.lastFullStatus!;
    expect(final.error).toBe(
      "Agent reached the cost limit for this message (~$0.6000 of the $0.50 budget). Send another message to continue.",
    );
    expect(systemMessages(final)).toEqual([
      "The agent reached the cost limit for this message. Work completed so far has been saved. " +
        "Send another message to continue where the agent left off.",
    ]);
    expect(final.streamingUsage?.estimatedCostUsd).toBe(0.6);
    expect(aiMessages(final)).not.toContain(NEVER_SEEN);
  });

  it("a platform STOP answered to a persist completes the turn early; the step after the STOP never runs", async () => {
    clock.reset();
    const adapter = fakeAdapter([[scenario.say("Starting the suite."), scenario.say(NEVER_SEEN)]]);
    const rec = record({
      controlSignal: (status) =>
        status.messages.some((m) => m.type === MessageType.MESSAGE_AI) ? ExecutionControlSignal.STOP : ExecutionControlSignal.UNSPECIFIED,
    });

    const invocation = await runRuntimeTurn({ record: rec, adapter, config });

    expect(slimOf(invocation).phase).toBe("EXECUTION_COMPLETED");
    expect(rec.persistedPhases).toEqual([ExecutionPhase.EXECUTION_IN_PROGRESS, ExecutionPhase.EXECUTION_COMPLETED]);
    const final = rec.lastFullStatus!;
    expect(final.error, "a platform stop is not an error").toBe("");
    expect(systemMessages(final)).toEqual([TERMINAL_COPY.platformStop.row]);
    expect(aiMessages(final)).toEqual(["Starting the suite."]);
  });

  it("an engine-cancelled run ends CANCELLED with no error and no copy", async () => {
    clock.reset();
    const adapter = fakeAdapter([[scenario.say("Looking at the pull requests."), scenario.cancelled(), scenario.say(NEVER_SEEN)]]);
    const rec = record();

    const invocation = await runRuntimeTurn({ record: rec, adapter, config });

    expect(slimOf(invocation).phase).toBe("EXECUTION_CANCELLED");
    expect(slimOf(invocation)).not.toHaveProperty("final_text");
    expect(rec.persistedPhases).toEqual([ExecutionPhase.EXECUTION_IN_PROGRESS, ExecutionPhase.EXECUTION_CANCELLED]);
    const final = rec.lastFullStatus!;
    expect(final.error).toBe("");
    expect(final.completedAt).not.toBe("");
    expect(systemMessages(final)).toEqual([]);
    expect(aiMessages(final)).not.toContain(NEVER_SEEN);
  });

  it.each([
    ["engine", "UNAUTHENTICATED: invalid api key", []],
    [
      "actionable",
      "A hook outside the approval gate blocked tool(s): shell.",
      ["Execution failed: A hook outside the approval gate blocked tool(s): shell."],
    ],
    [
      "internal",
      "Engine rejected the request: invalid API key",
      [TERMINAL_COPY.internalFailure.row, "Error details: Engine rejected the request: invalid API key"],
    ],
  ] as const)("a failed turn on the %s surface writes that surface's copy and returns", async (surface, message, rows) => {
    clock.reset();
    const adapter = fakeAdapter([[scenario.say("Checking the repository."), scenario.fail(message, surface)]]);
    const rec = record();

    const invocation = await runRuntimeTurn({ record: rec, adapter, config });

    expect(slimOf(invocation).phase).toBe("EXECUTION_FAILED");
    expect(rec.persistedPhases).toEqual([ExecutionPhase.EXECUTION_IN_PROGRESS, ExecutionPhase.EXECUTION_FAILED]);
    const final = rec.lastFullStatus!;
    expect(final.error).toBe(message);
    expect(final.completedAt).not.toBe("");
    expect(systemMessages(final)).toEqual(rows);
  });

  it("a rejected bindHarnessState ends the turn failed with nothing executed (Q-S2-11)", async () => {
    clock.reset();
    const adapter = fakeAdapter([[scenario.say(NEVER_SEEN)]]);
    const rec = record();

    const invocation = await runRuntimeTurn({
      record: rec,
      adapter,
      config,
      clientOverrides: {
        updateSession: vi.fn(async () => {
          throw new Error("session write refused");
        }),
      },
    });

    expect(slimOf(invocation).phase).toBe("EXECUTION_FAILED");
    const final = rec.lastFullStatus!;
    expect(final.error).toContain("could not bind engine state");
    expect(systemMessages(final)[0]).toBe(TERMINAL_COPY.internalFailure.row);
    expect(aiMessages(final)).not.toContain(NEVER_SEEN);
  });

  it("an error during resolution fails the turn through the internal arm before any engine runs", async () => {
    clock.reset();
    const adapter = fakeAdapter([[scenario.say(NEVER_SEEN)]]);
    const rec = record();

    const invocation = await runRuntimeTurn({
      record: rec,
      adapter,
      config,
      clientOverrides: {
        getAgent: vi.fn(async () => {
          throw new Error("runtime fault injected at getAgent");
        }),
      },
    });

    expect(slimOf(invocation).phase).toBe("EXECUTION_FAILED");
    expect(rec.persistedPhases, "nothing was persisted before the failure").toEqual([ExecutionPhase.EXECUTION_FAILED]);
    const final = rec.lastFullStatus!;
    expect(final.error).toBe("Execution failed: [Error] runtime fault injected at getAgent");
    expect(systemMessages(final)).toEqual([
      TERMINAL_COPY.internalFailure.row,
      "Error details: [Error] runtime fault injected at getAgent",
    ]);
    expect(rec.setupProgress).toEqual(["Fetching execution", "Resolving agent blueprint"]);
    expect(rec.sessionUpdates).toHaveLength(0);
  });

  it("a workspace lock held by another turn settles FAILED with the lock's message and its one row", async () => {
    clock.reset();
    const adapter = fakeAdapter([[scenario.say(NEVER_SEEN)]]);
    const rec = record();
    // The session's own workspace directory, as the provisioner will resolve it.
    const workspaceDir = join(env.workspaceRootDir, "sessions", rec.session.metadata!.id);
    mkdirSync(workspaceDir, { recursive: true });
    const release = await acquireWorkspaceLock(workspaceDir);
    try {
      const invocation = await runRuntimeTurn({
        record: rec,
        adapter,
        config: { ...config, workspaceLockTimeoutMs: 500 },
      });

      expect(slimOf(invocation).phase).toBe("EXECUTION_FAILED");
      expect(rec.persistedPhases).toEqual([ExecutionPhase.EXECUTION_FAILED]);
      const final = rec.lastFullStatus!;
      const resolvedDir = await realpath(workspaceDir);
      expect(final.error).toContain(`Workspace is in use by another session: ${resolvedDir}`);
      expect(systemMessages(final)).toEqual([`Execution failed: ${final.error}`]);
      expect(rec.setupProgress.at(-1)).toBe("Waiting for workspace — in use by another session");
      expect(rec.sessionUpdates).toHaveLength(0);
    } finally {
      await release();
    }
  });
});
