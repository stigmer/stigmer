/**
 * The harness contract kit — the RUNTIME-SIDE half: what the turn runtime
 * (`harness/run-turn.ts`) owes every harness, proven end to end through the
 * real activity under `MockActivityEnvironment`, against any
 * {@link HarnessContractSubject}.
 *
 * `contract.ts` is the adapter-side half (the kit stands in for the runtime).
 * Here the roles flip: {@link RuntimeExecutionDriver} is the real runtime as
 * the driver — `createHarnessActivities` over the subject's adapter, the
 * hermetic `ExecutionRecord` as the control plane, the record's client bound
 * for the invocation — and the subject still owns the engine, arranged from
 * the view the record implies (`approvalDecisionsOf` over what the record
 * persisted, the runtime's own reader). The two drivers share their verbs
 * (`turn`, `decide`) so a subject's file reads the same either side of the
 * contract line.
 *
 * ── The arms ────────────────────────────────────────────────────────────────
 * Each arm is the throw-vs-return table's row for one way a turn ends, plus
 * the facts the runtime owes on it: the terminal phase, the copy
 * (`terminal-table.ts` `TERMINAL_COPY`, byte-pinned), `status.error`,
 * `completedAt`, "the step after never runs", the whole-activity heartbeat,
 * one bind for an engine-minted harness, the slim return. What is NOT
 * asserted here is engine cadence — how many IN_PROGRESS persists precede
 * the WAITING write, the exact setup labels beyond the runtime's own, the
 * exact price a vendor's table yields — because those are a subject's facts;
 * every arm returns the invocation and the record so a subject's file adds
 * them (`harness/__tests__/run-turn.test.ts` does, for the fake).
 *
 * How an arm is provoked without a timer: the subject's `whenHanging()`
 * reports the engine parked, and THAT is when the arm delivers the
 * cancellation (pause), the drain then the cancellation (worker shutdown), or
 * the clock tick that trips the stall watchdog (which measures idle time on
 * `Date.now()`, owned by the scripted clock; its poll is real and sub-second
 * at the window used here).
 *
 * Every arm is an exported async function first and an `it` block second, as
 * in `contract.ts`; `describeHarnessRuntimeContract` boots the adapter before
 * the first arm and shuts it down after the last, as the registry does. Each
 * arm runs its own execution under a `label` (its ids and its tool-call ids
 * derive from it), so a subject's file that re-runs an arm to add its facts
 * passes a label of its own — two executions never share a session or a
 * tool-call id, on the fake (whose execution counts are per id) or on a real
 * engine (whose parked agent is per session).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApprovalAction, ExecutionControlSignal, ExecutionPhase, MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import type { StigmerClient } from "../../client/stigmer-client.js";
import type { Config } from "../../config.js";
import { HARNESS_ACTIVITY_NAMES, createHarnessActivities } from "../../harness/registry.js";
import { TERMINAL_COPY } from "../../harness/terminal-table.js";
import { REJECTED_BY_USER_ERROR, approvalDecisionsOf } from "../../harness/approval-decisions.js";
import { TOOL_CALL_LIMIT_ERROR_PREFIX, TOOL_CALL_LIMIT_USER_COPY, formatToolCallLimitError } from "../../shared/tool-rounds.js";
import type { FailureSurface } from "../../harness/types.js";
import type { ExecuteActivityInput } from "../../shared/activity-input.js";
import { acquireWorkspaceLock } from "../../shared/workspace/workspace-lock.js";
import { executionRecordFixture, type ExecutionRecordOptions } from "../execution-record-fixture.js";
import {
  ExecutionRecord,
  ScriptedClock,
  bindHermeticClient,
  runActivityHermetically,
  threwCancelledFailure,
  type ActivityInvocation,
  type HermeticEnvironment,
  type InvocationControls,
} from "../hermetic-activity.js";
import { emptyStatus } from "../proto-helpers.js";
import { scenario } from "./types.js";
import type { EngineView, HarnessContractSubject, TurnScenario } from "./types.js";

/** Text that must never reach the transcript: every arm places it after the step that ends the turn. */
export const NEVER_SEEN = "This text must never reach the transcript.";

/** The user's message every runtime arm asks. */
export const RUNTIME_USER_MESSAGE = "Summarize the repository.";

/** Above the clock's 1 s step and small enough that the watchdog's real poll (stallMs / 4) fires promptly. */
export const STALL_TIMEOUT_MS = 2_000;

/** The cost-cap arm's numbers, the same the Cursor golden prices: 600 000 input tokens against a $0.50 budget. */
export const COST_CAP_BUDGET_USD = 0.5;
export const COST_CAP_INPUT_TOKENS = 600_000;
/** What the fake states for those tokens; a real adapter prices them itself and must land above the budget too. */
export const COST_CAP_FAKE_PRICE_USD = 0.6;

/** The runtime's own resolution labels, in order; a harness's setup labels follow them. */
export const RUNTIME_SETUP_LABELS = [
  "Fetching execution",
  "Resolving agent blueprint",
  "Resolving environment",
  "Provisioning workspace",
  "Resolving MCP servers",
  "Resolving skills",
] as const;

/** What a runtime-half suite runs on: one subject, one hermetic environment, one scripted clock. */
export interface RuntimeContractHarness {
  readonly subject: HarnessContractSubject;
  readonly env: HermeticEnvironment;
  readonly clock: ScriptedClock;
}

export interface RuntimeTurnOptions {
  /** Control-plane facets or faults over the record's everyday answers (a rejecting `getAgent` stages a resolution failure). */
  readonly clientOverrides?: Partial<StigmerClient>;
  /** Runtime knobs over the subject's config for this invocation (the stall and lock windows); never an adapter field. */
  readonly config?: Partial<Config>;
  readonly onControls?: (controls: InvocationControls) => void;
}

export function systemMessages(status: AgentExecutionStatus): string[] {
  return status.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM).map((m) => m.content);
}

/** The assistant's texts; a message that only carries tool-call rows has none and is not one. */
export function aiMessages(status: AgentExecutionStatus): string[] {
  return status.messages.filter((m) => m.type === MessageType.MESSAGE_AI && m.content !== "").map((m) => m.content);
}

/** The slim status an activity returned; a throw here is the arm's failure, named. */
export function slimOf(subject: HarnessContractSubject, invocation: ActivityInvocation): Record<string, unknown> {
  if (invocation.outcome.kind !== "returned") {
    const error = invocation.outcome.error;
    throw new Error(`${subject.name}: the activity threw where the table says it returns (${error instanceof Error ? error.message : String(error)})`);
  }
  return invocation.outcome.value as Record<string, unknown>;
}

/**
 * One execution's worth of turns through the REAL runtime against one
 * subject. A new driver per arm, with its own record under its own ids (a
 * real engine is per session; two arms on one session would share a parked
 * engine). It threads the state id the runtime bound (an engine-minted
 * harness's `sessionUpdates`; a deterministic harness's runtime-minted id)
 * and advances `turnSeq`, as the workflow does between invocations.
 */
export class RuntimeExecutionDriver {
  readonly record: ExecutionRecord;
  private threadId: string;
  private turnSeq = 0;

  constructor(
    private readonly harness: RuntimeContractHarness,
    label: string,
    recordOptions: Omit<ExecutionRecordOptions, "ids" | "message"> & { readonly message?: string } = {},
  ) {
    this.record = executionRecordFixture({
      message: RUNTIME_USER_MESSAGE,
      ...recordOptions,
      ids: {
        org: "kit-org",
        executionId: `aex-${label}`,
        sessionId: `ses-${label}`,
        agentInstanceId: `ain-${label}`,
        agentId: `agt-${label}`,
        agentName: `agent-${label}`,
      },
    });
    this.threadId = harness.subject.adapter.capabilities.stateIdSource === "deterministic" ? `thread-${this.sessionId}` : "";
  }

  get sessionId(): string {
    return this.record.session.metadata!.id;
  }

  /** The session's workspace directory, as the runtime's provisioner will resolve it. */
  get workspaceDir(): string {
    return join(this.harness.env.workspaceRootDir, "sessions", this.sessionId);
  }

  /** One activity invocation: arrange the engine from the record's view, then run the real activity for the subject's row. */
  async turn(turn: TurnScenario, options: RuntimeTurnOptions = {}): Promise<ActivityInvocation> {
    const { subject } = this.harness;
    // The decisions come off the status the server HOLDS (`record.status`, what
    // the runtime fetches and where `SubmitApproval` writes), never off a
    // persisted snapshot.
    const view: EngineView = {
      executionId: this.record.executionId,
      sessionId: this.sessionId,
      approvalDecisions: approvalDecisionsOf(this.record.status ?? emptyStatus()),
    };
    subject.arrange(turn, view);
    bindHermeticClient(this.record.client(options.clientOverrides));
    const config: Config = { ...subject.config, ...options.config };
    const activity = (await createHarnessActivities([{ harness: subject.harness, adapter: subject.adapter }], config))[HARNESS_ACTIVITY_NAMES[subject.harness]];
    if (!activity) throw new Error(`${subject.name}: the registry built no activity for row '${subject.harness}' (kit bug)`);
    const input: ExecuteActivityInput = {
      execution_id: this.record.executionId,
      thread_id: this.threadId,
      turn_seq: this.turnSeq,
    };
    const invocation = await runActivityHermetically(activity, [input], { taskQueue: config.taskQueue, onControls: options.onControls });
    const bound = this.record.sessionUpdates.at(-1)?.spec?.harnessStateId;
    if (bound) this.threadId = bound;
    this.turnSeq += 1;
    return invocation;
  }

  /** The server's act between invocations: decide every WAITING row. Returns how many. */
  decide(action: ApprovalAction): number {
    this.harness.clock.tick();
    return this.record.decideWaitingToolCalls(action, new Date().toISOString());
  }
}

/** The final full status the record holds; an arm that persisted nothing is a failure, named. */
function finalStatusOf(harness: RuntimeContractHarness, driver: RuntimeExecutionDriver): AgentExecutionStatus {
  const final = driver.record.lastFullStatus;
  if (!final) throw new Error(`${harness.subject.name}: the runtime persisted no full status`);
  return final;
}

/** What every arm hands back so a subject's file can add its own facts. */
export interface RuntimeArmResult {
  readonly driver: RuntimeExecutionDriver;
  readonly invocations: readonly ActivityInvocation[];
  readonly final: AgentExecutionStatus;
}

// ── Arm: completed ──────────────────────────────────────────────────────────

/**
 * A completed turn: the runtime's own six resolution labels lead the setup
 * progress (a harness's follow), an engine-minted adapter binds exactly once
 * and its id is on the session, the slim return carries `final_text` and no
 * transcript, `completedAt` is stamped, no error, the whole-activity
 * heartbeat pulsed, and the usage the adapter priced is summed on the status.
 */
export async function assertCompletedTurn(harness: RuntimeContractHarness, label = "rt-completed"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label);
  const text = "The repository has three packages.";
  const invocation = await driver.turn([scenario.say(text), scenario.usage({ inputTokens: 1_200, outputTokens: 40, estimatedCostUsd: 0.00136, model: "fixture-model", requestedModelParams: "" })]);

  const slim = slimOf(subject, invocation);
  expect(slim.phase, `${subject.name}: a completed turn returns COMPLETED`).toBe("EXECUTION_COMPLETED");
  expect(slim.final_text, `${subject.name}: the slim return carries the last assistant text`).toBe(text);
  expect(slim, `${subject.name}: the slim return carries no transcript`).not.toHaveProperty("messages");
  expect(driver.record.persistedPhases.at(-1), `${subject.name}: the last persist is COMPLETED`).toBe(ExecutionPhase.EXECUTION_COMPLETED);
  expect(driver.record.setupProgress.slice(0, RUNTIME_SETUP_LABELS.length), `${subject.name}: the runtime's resolution labels lead the setup progress`).toEqual([...RUNTIME_SETUP_LABELS]);
  if (subject.adapter.capabilities.stateIdSource === "engine-minted") {
    expect(driver.record.sessionUpdates, `${subject.name}: an engine-minted adapter binds once`).toHaveLength(1);
    expect(driver.record.sessionUpdates[0]?.spec?.harnessStateId, `${subject.name}: the bound id is on the session`).toBeTruthy();
  } else {
    expect(driver.record.sessionUpdates, `${subject.name}: a deterministic adapter binds nothing`).toHaveLength(0);
  }
  const final = finalStatusOf(harness, driver);
  expect(final.completedAt, `${subject.name}: a completed turn is stamped`).not.toBe("");
  expect(final.error, `${subject.name}: a completed turn carries no error`).toBe("");
  expect(final.streamingUsage?.inputTokens, `${subject.name}: the usage the adapter reported is summed on the status`).toBe(1_200n);
  expect(invocation.heartbeats.length, `${subject.name}: the whole-activity heartbeat pulsed`).toBeGreaterThan(0);
  return { driver, invocations: [invocation], final };
}

// ── Arm: awaiting_approval then APPROVE ─────────────────────────────────────

/**
 * The approval round trip: the proposal RETURNS `WAITING_FOR_APPROVAL` with
 * one WAITING row and nothing executed; the user approves; the reinvocation
 * by the bound id executes it exactly once, clears the wait, completes, and
 * binds nothing new. The proposal is a `shell`, the built-in every harness
 * gates in every workspace posture (under the real runtime the hermetic
 * environment carries artifact storage, which puts a `write` on
 * apply-then-review capture instead of the gate).
 */
export async function assertApprovalRoundTrip(harness: RuntimeContractHarness, label = "rt-approval"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label);
  const id = `${label}-shell`;
  const propose = scenario.propose(id, { kind: "shell", resource: `npm run build # ${label}` });

  const first = await driver.turn([propose]);
  expect(slimOf(subject, first).phase, `${subject.name}: a proposal returns WAITING_FOR_APPROVAL`).toBe("EXECUTION_WAITING_FOR_APPROVAL");
  expect(driver.record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL);
  expect(driver.record.waitingToolCalls().map((tc) => tc.id), `${subject.name}: exactly the proposal waits`).toEqual([id]);
  expect(subject.executionCount(id), `${subject.name}: a proposal never executes in its own turn`).toBe(0);
  const bindsAfterFirst = driver.record.sessionUpdates.length;

  expect(driver.decide(ApprovalAction.APPROVE), `${subject.name}: one row to decide`).toBe(1);

  const second = await driver.turn([propose, scenario.say("Done.")]);
  expect(slimOf(subject, second).phase, `${subject.name}: after APPROVE the turn completes`).toBe("EXECUTION_COMPLETED");
  expect(slimOf(subject, second).final_text).toBe("Done.");
  expect(subject.executionCount(id), `${subject.name}: APPROVE executes exactly once`).toBe(1);
  expect(driver.record.waitingToolCalls(), `${subject.name}: nothing waits after the approval`).toHaveLength(0);
  expect(driver.record.sessionUpdates, `${subject.name}: a resumed engine binds nothing new`).toHaveLength(bindsAfterFirst);
  return { driver, invocations: [first, second], final: finalStatusOf(harness, driver) };
}

// ── Arm: awaiting_approval then REJECT or SKIP ──────────────────────────────

/**
 * A decision that never runs the tool: the user REJECTs (or SKIPs) the
 * proposal; the reinvocation continues WITHOUT it — the adapter's next step
 * runs, the turn COMPLETES, the tool executes zero times — and the runtime
 * settles the row SKIPPED (a REJECT row carries `error: "Rejected by user"`),
 * so no WAITING row survives on a finished execution. This is the proto
 * contract as of stigmer#197 and the runtime's own write
 * (`harness/approval-decisions.ts`); before S3 M1 the runtime FAILED a
 * REJECTed reinvocation before any engine ran.
 */
export async function assertNonExecutingDecisionSettlesSkipped(
  harness: RuntimeContractHarness,
  action: ApprovalAction.REJECT | ApprovalAction.SKIP,
  label = `rt-${ApprovalAction[action].toLowerCase()}`,
): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label);
  const id = `${label}-shell`;
  const propose = scenario.propose(id, { kind: "shell", resource: `rm -rf build # ${label}` });
  const verdict = ApprovalAction[action];

  const first = await driver.turn([propose]);
  expect(slimOf(subject, first).phase, `${subject.name}: a proposal returns WAITING_FOR_APPROVAL`).toBe("EXECUTION_WAITING_FOR_APPROVAL");
  expect(driver.decide(action), `${subject.name}: one row to decide`).toBe(1);

  const second = await driver.turn([propose, scenario.say("Moving on.")]);
  expect(slimOf(subject, second).phase, `${subject.name}: after ${verdict} the run continues to COMPLETED — it does not fail`).toBe("EXECUTION_COMPLETED");
  expect(slimOf(subject, second).final_text, `${subject.name}: the step after the ${verdict}ed action ran`).toBe("Moving on.");
  expect(subject.executionCount(id), `${subject.name}: a ${verdict}ed action never executes`).toBe(0);

  const final = finalStatusOf(harness, driver);
  const row = final.messages.flatMap((m) => m.toolCalls).find((tc) => tc.id === id);
  expect(row, `${subject.name}: the decided row is carried on the transcript`).toBeDefined();
  expect(row!.status, `${subject.name}: the runtime settles a ${verdict}ed row SKIPPED`).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
  expect(row!.approvalAction, `${subject.name}: the decision stays legible on the settled row`).toBe(action);
  expect(row!.error, `${subject.name}: a REJECT carries its reason, a SKIP carries none`).toBe(action === ApprovalAction.REJECT ? REJECTED_BY_USER_ERROR : "");
  expect(driver.record.waitingToolCalls(), `${subject.name}: nothing waits on a finished execution`).toHaveLength(0);
  expect(final.error, `${subject.name}: the execution carries no error`).toBe("");
  return { driver, invocations: [first, second], final };
}

// ── Arm: the tool-call limit ────────────────────────────────────────────────

/**
 * The engine exhausted its tool-round budget: TERMINATED (not FAILED — the
 * platform deliberately stopped the run and the conversation continues on
 * the next message), `error` starting with the cross-repo prefix Stigmer
 * Cloud's channel delivery matches on, the user copy as the one system row,
 * `completedAt` stamped, RETURNED (a retry would spend the same budget), and
 * the step after the limit never processed. Before S3 M1 the native harness
 * RETURNED this terminal without persisting it (M0 finding F-M0-4); the
 * runtime's arm is the one persisted terminal.
 */
export async function assertToolCallLimitTerminates(harness: RuntimeContractHarness, label = "rt-tool-call-limit"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label);
  const invocation = await driver.turn([scenario.say("Working…"), scenario.limit(), scenario.say(NEVER_SEEN)]);
  // `slimOf` is the RETURN assertion (a retry would spend the same budget).
  expect(slimOf(subject, invocation).phase, `${subject.name}: the tool-call limit is TERMINATED, not FAILED`).toBe("EXECUTION_TERMINATED");
  const final = finalStatusOf(harness, driver);
  expect(final.phase).toBe(ExecutionPhase.EXECUTION_TERMINATED);
  expect(final.error.startsWith(TOOL_CALL_LIMIT_ERROR_PREFIX), `${subject.name}: the error carries the cross-repo prefix; got "${final.error}"`).toBe(true);
  expect(final.error, `${subject.name}: the copy is the table's, byte for byte`).toBe(formatToolCallLimitError());
  expect(systemMessages(final), `${subject.name}: the user copy is the one system row`).toEqual([TOOL_CALL_LIMIT_USER_COPY]);
  expect(final.completedAt, `${subject.name}: a TERMINATED turn completes`).not.toBe("");
  expect(aiMessages(final), `${subject.name}: the step after the limit is never processed`).not.toContain(NEVER_SEEN);
  expect(driver.record.persistedPhases.at(-1), `${subject.name}: the terminal is persisted, not merely returned`).toBe(ExecutionPhase.EXECUTION_TERMINATED);
  return { driver, invocations: [invocation], final };
}

// ── Arms: the stop controller's producers ───────────────────────────────────

/** A hanging scenario with the never-seen text after the hang; the arms below stop it in three different ways. */
function hangingTurn(before: string): TurnScenario {
  return [scenario.say(before), scenario.hang(), scenario.say(NEVER_SEEN)];
}

/**
 * A user pause: Temporal's cancellation delivered while the engine hangs
 * persists PAUSED with the pause row written exactly once, no error, no
 * `completedAt`, and THROWS the pause `CancelledFailure` so the workflow
 * knows to wait.
 */
export async function assertPausePersistsAndThrows(harness: RuntimeContractHarness, label = "rt-pause"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label);
  let controls: InvocationControls | undefined;
  void subject.whenHanging().then(() => controls!.cancel());

  const invocation = await driver.turn(hangingTurn("Starting on the parser."), { onControls: (c) => (controls = c) });

  expect(threwCancelledFailure(invocation.outcome), `${subject.name}: a pause THROWS a CancelledFailure`).toBe(true);
  if (!threwCancelledFailure(invocation.outcome)) throw new Error("unreachable");
  expect(invocation.outcome.error.message).toBe(TERMINAL_COPY.pause.throwMessage);
  expect(driver.record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_PAUSED);
  const final = finalStatusOf(harness, driver);
  expect(final.error, `${subject.name}: a pause is not an error`).toBe("");
  expect(final.completedAt, `${subject.name}: a paused turn is not complete`).toBe("");
  expect(systemMessages(final), `${subject.name}: the pause row, exactly once`).toEqual([TERMINAL_COPY.pause.row]);
  expect(aiMessages(final)).not.toContain(NEVER_SEEN);
  return { driver, invocations: [invocation], final };
}

/**
 * A worker shutdown: the queue's shutdown signal aborts, then Temporal
 * cancels (the runner-manager's drain). FAILED with the shutdown copy, the
 * row exactly once, stamped, and the shutdown `CancelledFailure` thrown.
 */
export async function assertWorkerShutdownPersistsAndThrows(harness: RuntimeContractHarness, label = "rt-shutdown"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label);
  let controls: InvocationControls | undefined;
  void subject.whenHanging().then(() => {
    controls!.signalWorkerShutdown();
    controls!.cancel();
  });

  const invocation = await driver.turn(hangingTurn("Starting on the parser."), { onControls: (c) => (controls = c) });

  expect(threwCancelledFailure(invocation.outcome), `${subject.name}: a shutdown THROWS a CancelledFailure`).toBe(true);
  if (!threwCancelledFailure(invocation.outcome)) throw new Error("unreachable");
  expect(invocation.outcome.error.message).toBe(TERMINAL_COPY.workerShutdown.throwMessage);
  expect(driver.record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_FAILED);
  const final = finalStatusOf(harness, driver);
  expect(final.error).toBe(TERMINAL_COPY.workerShutdown.error);
  expect(final.completedAt).not.toBe("");
  expect(systemMessages(final), `${subject.name}: the shutdown row, exactly once`).toEqual([TERMINAL_COPY.workerShutdown.row]);
  expect(aiMessages(final)).not.toContain(NEVER_SEEN);
  return { driver, invocations: [invocation], final };
}

/**
 * A stall: the watchdog measures idle time on the scripted clock; one tick
 * past the window while the engine hangs fails the turn (RETURNED — a retry
 * would wedge again) with the watchdog's copy naming the idle seconds.
 */
export async function assertStallFailsTheTurn(harness: RuntimeContractHarness, label = "rt-stall"): Promise<RuntimeArmResult> {
  const { subject, clock } = harness;
  const driver = new RuntimeExecutionDriver(harness, label);
  void subject.whenHanging().then(() => clock.tick(STALL_TIMEOUT_MS));

  const invocation = await driver.turn(hangingTurn("Running the suite."), { config: { cursorStreamStallTimeoutMs: STALL_TIMEOUT_MS } });

  expect(slimOf(subject, invocation).phase, `${subject.name}: a stall RETURNS FAILED`).toBe("EXECUTION_FAILED");
  expect(driver.record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_FAILED);
  const final = finalStatusOf(harness, driver);
  expect(final.error).toMatch(/^\[StallTimeoutError\] Agent stream stalled: no activity for \d+s( \(last tool: [^)]+\))?\. Retry or resume\.$/);
  expect(systemMessages(final)).toHaveLength(1);
  expect(systemMessages(final)[0]).toMatch(
    /^Execution failed: the agent made no progress for too long and was stopped \(Agent stream stalled: no activity for \d+s( \(last tool: [^)]+\))?\)\. You can retry or resume\.$/,
  );
  expect(final.completedAt).not.toBe("");
  expect(aiMessages(final)).not.toContain(NEVER_SEEN);
  return { driver, invocations: [invocation], final };
}

/**
 * The cost cap: usage the adapter priced above the message's budget
 * TERMINATES the turn with the budget copy, the priced sum on the status,
 * and the step after the overrun never processed.
 */
export async function assertCostCapTerminates(harness: RuntimeContractHarness, label = "rt-cost-cap"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label, { maxCostUsd: COST_CAP_BUDGET_USD });

  const invocation = await driver.turn([
    scenario.say("Reading the whole repository first."),
    scenario.usage({ inputTokens: COST_CAP_INPUT_TOKENS, outputTokens: 0, estimatedCostUsd: COST_CAP_FAKE_PRICE_USD, model: "fixture-model" }),
    scenario.say(NEVER_SEEN),
  ]);

  expect(slimOf(subject, invocation).phase, `${subject.name}: the cost cap TERMINATES`).toBe("EXECUTION_TERMINATED");
  expect(driver.record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_TERMINATED);
  const final = finalStatusOf(harness, driver);
  expect(final.error).toMatch(/^Agent reached the cost limit for this message \(~\$[\d.]+ of the \$0\.50 budget\)\. Send another message to continue\.$/);
  expect(systemMessages(final)).toEqual([
    "The agent reached the cost limit for this message. Work completed so far has been saved. " +
      "Send another message to continue where the agent left off.",
  ]);
  expect(final.streamingUsage?.estimatedCostUsd ?? 0, `${subject.name}: the priced usage is above the budget`).toBeGreaterThan(COST_CAP_BUDGET_USD);
  expect(aiMessages(final)).not.toContain(NEVER_SEEN);
  return { driver, invocations: [invocation], final };
}

/**
 * A platform STOP answered to a mid-turn persist: the turn completes early
 * with the platform-stop row and no error, and the step after the STOP never
 * runs — the awaited `requestPersist` at work (Q-M3-2). The persist the
 * control plane answers is the one carrying a completed `read`: the discrete
 * event every harness flushes on (the Cursor golden's lever), where a bare
 * assistant message may ride an engine's cadence to the settle persist, too
 * late to stop anything.
 */
export async function assertPlatformStopCompletesEarly(harness: RuntimeContractHarness, label = "rt-platform-stop"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label, {
    controlSignal: (status) =>
      status.messages.some((m) => m.toolCalls.some((tc) => tc.status === ToolCallStatus.TOOL_CALL_COMPLETED))
        ? ExecutionControlSignal.STOP
        : ExecutionControlSignal.UNSPECIFIED,
  });

  const invocation = await driver.turn([scenario.say("Starting the suite."), scenario.read(`${label}-read`, "package.json"), scenario.say(NEVER_SEEN)]);

  expect(slimOf(subject, invocation).phase, `${subject.name}: a platform STOP completes the turn`).toBe("EXECUTION_COMPLETED");
  expect(driver.record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_COMPLETED);
  const final = finalStatusOf(harness, driver);
  expect(final.error, `${subject.name}: a platform stop is not an error`).toBe("");
  expect(systemMessages(final)).toEqual([TERMINAL_COPY.platformStop.row]);
  expect(aiMessages(final), `${subject.name}: the step after the STOP never runs`).toEqual(["Starting the suite."]);
  return { driver, invocations: [invocation], final };
}

// ── Arms: the engine ends its own run ───────────────────────────────────────

/** An engine-cancelled run ends CANCELLED: no error, no copy, no `final_text`, stamped. */
export async function assertEngineCancelledEndsCancelled(harness: RuntimeContractHarness, label = "rt-cancelled"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label);

  const invocation = await driver.turn([scenario.say("Looking at the pull requests."), scenario.cancelled(), scenario.say(NEVER_SEEN)]);

  const slim = slimOf(subject, invocation);
  expect(slim.phase, `${subject.name}: an engine cancel ends CANCELLED`).toBe("EXECUTION_CANCELLED");
  expect(slim).not.toHaveProperty("final_text");
  expect(driver.record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_CANCELLED);
  const final = finalStatusOf(harness, driver);
  expect(final.error).toBe("");
  expect(final.completedAt).not.toBe("");
  expect(systemMessages(final)).toEqual([]);
  expect(aiMessages(final)).not.toContain(NEVER_SEEN);
  return { driver, invocations: [invocation], final };
}

/**
 * A failed turn writes its surface's copy and RETURNS FAILED: the `engine`
 * surface writes no row (the engine's own message is the error); the
 * `actionable` surface writes one row carrying the message; the `internal`
 * surface writes the internal-failure row and an `Error details:` row. The
 * error text is the adapter's — a real engine's classifier rephrases it —
 * so only its presence is asserted here; a subject's file pins the exact
 * words.
 */
export async function assertFailedSurfaceWritesItsCopy(harness: RuntimeContractHarness, surface: FailureSurface, message: string, label = `rt-failed-${surface}`): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label);

  const invocation = await driver.turn([scenario.say("Checking the repository."), scenario.fail(message, surface), scenario.say(NEVER_SEEN)]);

  expect(slimOf(subject, invocation).phase, `${subject.name}: a ${surface} failure RETURNS FAILED`).toBe("EXECUTION_FAILED");
  expect(driver.record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_FAILED);
  const final = finalStatusOf(harness, driver);
  expect(final.error, `${subject.name}: a failed turn names its error`).not.toBe("");
  expect(final.completedAt).not.toBe("");
  const rows = systemMessages(final);
  switch (surface) {
    case "engine":
      expect(rows, `${subject.name}: an engine failure writes no row`).toEqual([]);
      break;
    case "actionable":
      expect(rows, `${subject.name}: an actionable failure writes one row`).toHaveLength(1);
      expect(rows[0]).toMatch(/^Execution failed: /);
      break;
    case "internal":
      expect(rows, `${subject.name}: an internal failure writes the internal row and the details row`).toHaveLength(2);
      expect(rows[0]).toBe(TERMINAL_COPY.internalFailure.row);
      expect(rows[1]).toMatch(/^Error details: /);
      break;
    default: {
      const exhaustive: never = surface;
      throw new Error(`unknown failure surface ${String(exhaustive)}`);
    }
  }
  expect(aiMessages(final)).not.toContain(NEVER_SEEN);
  return { driver, invocations: [invocation], final };
}

// ── Arms: failures before or around the engine ──────────────────────────────

/**
 * A rejected `bindHarnessState` (the session write refused) ends the turn
 * FAILED on the internal surface with nothing executed (Q-S2-11, R3).
 * Engine-minted harnesses only: a deterministic one never binds.
 */
export async function assertRejectedBindFails(harness: RuntimeContractHarness, label = "rt-bind-rejects"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label);

  const invocation = await driver.turn([scenario.say(NEVER_SEEN)], {
    clientOverrides: {
      updateSession: async () => {
        throw new Error("session write refused");
      },
    },
  });

  expect(slimOf(subject, invocation).phase, `${subject.name}: a rejected bind RETURNS FAILED`).toBe("EXECUTION_FAILED");
  const final = finalStatusOf(harness, driver);
  expect(final.error).not.toBe("");
  expect(systemMessages(final)[0], `${subject.name}: a rejected bind is an internal failure`).toBe(TERMINAL_COPY.internalFailure.row);
  expect(aiMessages(final), `${subject.name}: nothing ran after the rejected bind`).not.toContain(NEVER_SEEN);
  return { driver, invocations: [invocation], final };
}

/**
 * An error during resolution (before any engine runs) fails the turn through
 * the runtime's own unexpected-error arm: nothing persisted before the
 * failure, the two internal rows, the progress stopped at the failing phase,
 * no bind.
 */
export async function assertResolutionErrorFailsBeforeEngine(harness: RuntimeContractHarness, label = "rt-resolution-error"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label);

  const invocation = await driver.turn([scenario.say(NEVER_SEEN)], {
    clientOverrides: {
      getAgent: async () => {
        throw new Error("runtime fault injected at getAgent");
      },
    },
  });

  expect(slimOf(subject, invocation).phase).toBe("EXECUTION_FAILED");
  expect(driver.record.persistedPhases, `${subject.name}: nothing was persisted before the failure`).toEqual([ExecutionPhase.EXECUTION_FAILED]);
  const final = finalStatusOf(harness, driver);
  expect(final.error).toBe("Execution failed: [Error] runtime fault injected at getAgent");
  expect(systemMessages(final)).toEqual([TERMINAL_COPY.internalFailure.row, "Error details: [Error] runtime fault injected at getAgent"]);
  expect(driver.record.setupProgress).toEqual(["Fetching execution", "Resolving agent blueprint"]);
  expect(driver.record.sessionUpdates).toHaveLength(0);
  return { driver, invocations: [invocation], final };
}

/**
 * A workspace lock held by another turn past the window settles FAILED with
 * the lock's message and its one row, before any engine runs.
 */
export async function assertWorkspaceLockTimeoutFails(harness: RuntimeContractHarness, label = "rt-lock-timeout"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label);
  mkdirSync(driver.workspaceDir, { recursive: true });
  const release = await acquireWorkspaceLock(driver.workspaceDir);
  try {
    const invocation = await driver.turn([scenario.say(NEVER_SEEN)], { config: { workspaceLockTimeoutMs: 500 } });

    expect(slimOf(subject, invocation).phase).toBe("EXECUTION_FAILED");
    expect(driver.record.persistedPhases).toEqual([ExecutionPhase.EXECUTION_FAILED]);
    const final = finalStatusOf(harness, driver);
    const resolvedDir = await realpath(driver.workspaceDir);
    expect(final.error).toContain(`Workspace is in use by another session: ${resolvedDir}`);
    expect(systemMessages(final)).toEqual([`Execution failed: ${final.error}`]);
    expect(driver.record.setupProgress.at(-1)).toBe("Waiting for workspace — in use by another session");
    expect(driver.record.sessionUpdates).toHaveLength(0);
    return { driver, invocations: [invocation], final };
  } finally {
    await release();
  }
}

// ── The runnable suite ──────────────────────────────────────────────────────

export interface RuntimeContractOptions {
  /**
   * The failure surfaces this subject's engine can produce; the arm for any
   * other surface is registered SKIPPED with the reason (never a silent
   * pass). Every surface by default.
   */
  readonly failureSurfaces?: readonly FailureSurface[];
  /**
   * Whether this subject's engine can exhaust a tool-round budget and end a
   * turn `tool_call_limit` (`scenario.limit()`); the arm is registered
   * SKIPPED otherwise. On by default; the Cursor subject turns it off (its
   * SDK has no such budget).
   */
  readonly toolCallLimit?: boolean;
}

const ALL_SURFACES: readonly FailureSurface[] = ["engine", "actionable", "internal"];

/** The message each failure arm asks the engine to fail with; a subject's file may pin what its classifier makes of it. */
export const FAILURE_MESSAGES: Readonly<Record<FailureSurface, string>> = {
  engine: "UNAUTHENTICATED: invalid api key",
  actionable: "A hook outside the approval gate blocked tool(s): shell.",
  internal: "Engine rejected the request: invalid API key",
};

/** Register the runtime-side contract against one subject. Boots and shuts down the adapter around the arms. */
export function describeHarnessRuntimeContract(harness: RuntimeContractHarness, options: RuntimeContractOptions = {}): void {
  const { subject, clock } = harness;
  const surfaces = options.failureSurfaces ?? ALL_SURFACES;
  describe(`harness runtime contract — ${subject.name}`, () => {
    beforeAll(async () => {
      await subject.adapter.boot(subject.config);
    });
    afterAll(async () => {
      await subject.adapter.shutdown();
    });

    it("a completed turn: the runtime's labels, one bind, final_text, the summed usage, the heartbeat", async () => {
      clock.reset();
      await assertCompletedTurn(harness);
    });
    it("awaiting_approval then APPROVE: the WAITING row, the reinvocation by the bound id, one execution, COMPLETED", async () => {
      clock.reset();
      await assertApprovalRoundTrip(harness);
    });
    for (const action of [ApprovalAction.REJECT, ApprovalAction.SKIP] as const) {
      it(`awaiting_approval then ${ApprovalAction[action]}: the run continues without the tool and the runtime settles the row SKIPPED`, async () => {
        clock.reset();
        await assertNonExecutingDecisionSettlesSkipped(harness, action);
      });
    }
    it("a user pause persists PAUSED with the pause row once and throws the pause CancelledFailure", async () => {
      clock.reset();
      await assertPausePersistsAndThrows(harness);
    });
    it("a worker shutdown persists FAILED with the shutdown copy once and throws the shutdown CancelledFailure", async () => {
      clock.reset();
      await assertWorkerShutdownPersistsAndThrows(harness);
    });
    it("a stall fails the turn with the watchdog's idle time", async () => {
      clock.reset();
      await assertStallFailsTheTurn(harness);
    });
    it("a cost cap terminates the turn with the budget copy; the step after the overrun is never processed", async () => {
      clock.reset();
      await assertCostCapTerminates(harness);
    });
    it("a platform STOP answered to a persist completes the turn early; the step after the STOP never runs", async () => {
      clock.reset();
      await assertPlatformStopCompletesEarly(harness);
    });
    it("an engine-cancelled run ends CANCELLED with no error and no copy", async () => {
      clock.reset();
      await assertEngineCancelledEndsCancelled(harness);
    });
    it.skipIf(options.toolCallLimit === false)("a tool-call limit terminates the turn with the cross-repo prefix and the user copy, persisted and returned", async () => {
      clock.reset();
      await assertToolCallLimitTerminates(harness);
    });
    for (const surface of ALL_SURFACES) {
      it.skipIf(!surfaces.includes(surface))(`a failed turn on the ${surface} surface writes that surface's copy and returns`, async () => {
        clock.reset();
        await assertFailedSurfaceWritesItsCopy(harness, surface, FAILURE_MESSAGES[surface]);
      });
    }
    it.skipIf(subject.adapter.capabilities.stateIdSource !== "engine-minted")("a rejected bindHarnessState ends the turn failed with nothing executed (Q-S2-11)", async () => {
      clock.reset();
      await assertRejectedBindFails(harness);
    });
    it("an error during resolution fails the turn through the internal arm before any engine runs", async () => {
      clock.reset();
      await assertResolutionErrorFailsBeforeEngine(harness);
    });
    it("a workspace lock held by another turn settles FAILED with the lock's message and its one row", async () => {
      clock.reset();
      await assertWorkspaceLockTimeoutFails(harness);
    });
  });
}
