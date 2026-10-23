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
 * the view the record implies (`approval-answers.ts` `approvalAnswersOf` over
 * the answers on the record's log, the runtime's own map). The two drivers share their verbs
 * (`turn`, `decide`) so a subject's file reads the same either side of the
 * contract line.
 *
 * ── The arms ────────────────────────────────────────────────────────────────
 * Each arm is the throw-vs-return table's row for one way a turn ends, plus
 * the facts the runtime owes on it: the terminal phase, the copy
 * (`terminal-table.ts` `TERMINAL_COPY`, byte-pinned), `status.error`,
 * `completedAt`, "the step after never runs", the whole-activity heartbeat,
 * one bind for an engine-minted harness, the slim return, and — on every
 * arm, whatever the outcome — a transcript that streams nothing once the
 * turn has settled ({@link assertTranscriptStreamsNothing}). What is NOT
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
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { RunControlSignal, RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { create } from "@bufbuild/protobuf";
import { type RunStatus } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { StreamingUsageSummarySchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/usage_pb";
import { RunConfigSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/invocation_pb";
import { AppendSessionEventsResponseSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { WorkspaceWriteBackPhase, WorkspaceWriteBackSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/writeback_pb";

import type { StigmerClient } from "../../client/stigmer-client.js";
import type { Config } from "../../config.js";
import { HARNESS_ACTIVITY_NAMES, createHarnessActivities } from "../../harness/registry.js";
import { TERMINAL_COPY } from "../../harness/terminal-table.js";
import { approvalAnswersOf } from "../../harness/approval-answers.js";
import { REJECTED_BY_USER_ERROR } from "../../harness/approval-decisions.js";
import { MIN_TOOL_ROUNDS, TOOL_CALL_LIMIT_ERROR_PREFIX, TOOL_CALL_LIMIT_USER_COPY, formatToolCallLimitError } from "../../shared/tool-rounds.js";
import { SUMMARY_UPDATE_CLAUSE } from "../../middleware/compaction-prompt.js";
import type { FailureSurface, HarnessAdapter } from "../../harness/types.js";
import type { ExecuteActivityInput } from "../../shared/activity-input.js";
import { acquireWorkspaceLock } from "../../shared/workspace/workspace-lock.js";
import { DEFAULT_RECORD_IDS, executionRecordFixture, savedAgentFixture, type ExecutionRecordOptions } from "../execution-record-fixture.js";
import { initGitWorkspace } from "../git-workspace-fixture.js";
import {
  ExecutionRecord,
  ScriptedClock,
  bindHermeticClient,
  continuationCauseOf,
  runActivityHermetically,
  threwCancelledFailure,
  type ActivityInvocation,
  type HermeticEnvironment,
  type InvocationControls,
} from "../hermetic-activity.js";
import { emptyRows, emptyStatus, findToolCallRow } from "../proto-helpers.js";
import { expectKnownGap, type KnownGap, type TodayOutcome } from "../known-gap.js";
import { KIT_SUBAGENT_INSTRUCTIONS, KIT_SUBAGENT_SLUG, scenario } from "./types.js";
import type { EngineView, HarnessContractSubject, LongTurnControls, TurnScenario } from "./types.js";
import type { AgentMessage, TurnRows } from "../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import {
  ApprovalAction,
  MessageType,
  ToolCallStatus,
} from "../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

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
  "Fetching values from vaults",
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
  /** Control-plane facets or faults over the record's everyday answers (a rejecting `getSession` stages a resolution failure). */
  readonly clientOverrides?: Partial<StigmerClient>;
  /** Runtime knobs over the subject's config for this invocation (the stall and lock windows); never an adapter field. */
  readonly config?: Partial<Config>;
  readonly onControls?: (controls: InvocationControls) => void;
}

export function systemMessages(rows: { readonly messages: readonly AgentMessage[] }): string[] {
  return rows.messages.filter((m) => m.type === MessageType.MESSAGE_SYSTEM).map((m) => m.content);
}

/** The assistant's texts; a message that only carries tool-call rows has none and is not one. */
export function aiMessages(rows: { readonly messages: readonly AgentMessage[] }): string[] {
  return rows.messages.filter((m) => m.type === MessageType.MESSAGE_AI && m.content !== "").map((m) => m.content);
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
 * harness's `harnessBinds`; a deterministic harness's runtime-minted id)
 * and sets `turnSeq` as the workflow does between invocations: one more
 * after an invocation that returned (an approval cycle), 0 after one that
 * threw (a drain, a lost runner, a stall the model owed or a pause, which
 * the workflow recovers by running the turn from its first invocation).
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
        agentId: `agt-${label}`,
        agentName: `agent-${label}`,
        agentVersionHash: DEFAULT_RECORD_IDS.agentVersionHash,
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
    // The decisions come off the log and the rows the runner last wrote
    // from (`record.sessionEvents` and `record.rows`, what the runtime's door
    // reads over the asks it seeds).
    const view: EngineView = {
      executionId: this.record.executionId,
      sessionId: this.sessionId,
      approvalDecisions: approvalAnswersOf(this.record.executionId, this.record.rows ?? emptyRows(), this.record.sessionEvents).decisions,
      sendMessage: (text) => {
        this.record.sendMessage(text);
      },
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
    const bound = this.record.harnessBinds.at(-1)?.harnessStateId;
    if (bound) this.threadId = bound;
    this.turnSeq = invocation.outcome.kind === "threw" ? 0 : this.turnSeq + 1;
    return invocation;
  }

  /** The server's act between invocations: answer every WAITING row on the log. Returns how many. */
  decide(action: ApprovalAction, denyMessage = ""): number {
    this.harness.clock.tick();
    return this.record.decideWaitingToolCalls(action, new Date().toISOString(), undefined, denyMessage);
  }

  /**
   * The reconcile turn an Undo on this finished run starts
   * (`ExecutionRecord.startReconcileTurn`), run through the real runtime
   * over a guard of the subject's adapter whose `runTurn` only counts: the
   * short path must never reach it. Returns the invocation and how many
   * times the engine was asked.
   */
  async reconcileTurn(options: RuntimeTurnOptions = {}): Promise<{ readonly invocation: ActivityInvocation; readonly engineCalls: number }> {
    const { subject } = this.harness;
    const runId = this.record.startReconcileTurn();
    let engineCalls = 0;
    const guard: HarnessAdapter = {
      name: subject.adapter.name,
      capabilities: subject.adapter.capabilities,
      boot: (config) => subject.adapter.boot(config),
      shutdown: () => subject.adapter.shutdown(),
      releaseSession: (sessionId) => subject.adapter.releaseSession(sessionId),
      runTurn: async () => {
        engineCalls += 1;
        return { kind: "failed", message: "a reconcile turn reached the engine", surface: "internal" };
      },
    };
    bindHermeticClient(this.record.client(options.clientOverrides));
    const config: Config = { ...subject.config, ...options.config };
    const activity = (await createHarnessActivities([{ harness: subject.harness, adapter: guard }], config))[HARNESS_ACTIVITY_NAMES[subject.harness]];
    if (!activity) throw new Error(`${subject.name}: the registry built no activity for row '${subject.harness}' (kit bug)`);
    const input: ExecuteActivityInput = { execution_id: runId, thread_id: "", turn_seq: 0 };
    const invocation = await runActivityHermetically(activity, [input], { taskQueue: config.taskQueue, onControls: options.onControls });
    return { invocation, engineCalls };
  }
}

/**
 * The final full status the record holds, checked for the one fact every
 * settled turn owes its transcript (the rows it was written from) before the
 * arm reads anything else. An arm that persisted nothing is a failure, named.
 */
function finalStatusOf(harness: RuntimeContractHarness, driver: RuntimeExecutionDriver): RunStatus {
  const final = driver.record.lastFullStatus;
  if (!final) throw new Error(`${harness.subject.name}: the runtime persisted no full status`);
  assertTranscriptStreamsNothing(harness.subject.name, driver.record.rowsOf(final));
  return final;
}

/** The rows the final full status was written from, checked as {@link finalStatusOf} checks them. */
function finalRowsOf(harness: RuntimeContractHarness, driver: RuntimeExecutionDriver): TurnRows {
  return driver.record.rowsOf(finalStatusOf(harness, driver));
}

/**
 * No streaming flag survives a settled turn — on any message, any tool-call
 * row, in the root transcript or a sub-agent's — however the turn ended. A
 * flag left on is a spinner the console never stops. The runtime closes
 * them once, after `runTurn` returns, on every path (`harness/run-turn.ts`),
 * so the fact holds for every subject and every outcome, and every arm
 * checks it through {@link finalStatusOf}. Before the runtime owned that
 * close, this fired on both real adapters' internal-failure arm: a turn that
 * failed before its settle left its last message streaming. Exported so the
 * kit's self-check can hand it a status that still streams and prove it
 * fires.
 */
export function assertTranscriptStreamsNothing(subjectName: string, rows: TurnRows): void {
  const streaming: string[] = [];
  const sweep = (scope: string, messages: TurnRows["messages"]): void => {
    messages.forEach((m, i) => {
      if (m.isStreaming) streaming.push(`${scope}messages[${i}]`);
      for (const tc of m.toolCalls) {
        if (tc.isStreaming) streaming.push(`${scope}messages[${i}].toolCalls[${tc.id}]`);
      }
    });
  };
  sweep("", rows.messages);
  for (const sub of rows.subAgentRuns) sweep(`subAgentExecutions[${sub.id}].`, sub.messages);
  if (streaming.length > 0) {
    throw new Error(`${subjectName}: a settled turn's transcript is still streaming at ${streaming.join(", ")}`);
  }
}

/** What every arm hands back so a subject's file can add its own facts. */
export interface RuntimeArmResult {
  readonly driver: RuntimeExecutionDriver;
  readonly invocations: readonly ActivityInvocation[];
  readonly final: RunStatus;
}

// ── Arm: completed ──────────────────────────────────────────────────────────

/**
 * A completed turn: the runtime's own six resolution labels lead the setup
 * progress (a harness's follow), an engine-minted adapter binds exactly once
 * and its id is on the session, the persisted transcript ends with the answer
 * and the slim return carries none of it, `completedAt` is stamped, no error, the whole-activity
 * heartbeat pulsed, and the usage the adapter priced is summed on the status.
 */
export async function assertCompletedTurn(harness: RuntimeContractHarness, label = "rt-completed"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label);
  const text = "The repository has three packages.";
  const invocation = await driver.turn([scenario.say(text), scenario.usage({ inputTokens: 1_200, outputTokens: 40, estimatedCostUsd: 0.00136, model: "fixture-model", requestedModelParams: "" })]);

  const slim = slimOf(subject, invocation);
  expect(slim.phase, `${subject.name}: a completed turn returns COMPLETED`).toBe("RUN_COMPLETED");
  expect(slim, `${subject.name}: the slim return carries no transcript`).not.toHaveProperty("messages");
  expect(driver.record.persistedPhases.at(-1), `${subject.name}: the last persist is COMPLETED`).toBe(RunPhase.RUN_COMPLETED);
  expect(driver.record.setupProgress.slice(0, RUNTIME_SETUP_LABELS.length), `${subject.name}: the runtime's resolution labels lead the setup progress`).toEqual([...RUNTIME_SETUP_LABELS]);
  if (subject.adapter.capabilities.stateIdSource === "engine-minted") {
    expect(driver.record.harnessBinds, `${subject.name}: an engine-minted adapter binds once`).toHaveLength(1);
    expect(driver.record.harnessBinds[0]?.harnessStateId, `${subject.name}: the bound id reaches the session's door`).toBeTruthy();
  } else {
    expect(driver.record.harnessBinds, `${subject.name}: a deterministic adapter binds nothing`).toHaveLength(0);
  }
  const final = finalStatusOf(harness, driver);
  expect(aiMessages(driver.record.rowsOf(final)).at(-1), `${subject.name}: the transcript ends with the last assistant text`).toBe(text);
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
 * gates in every workspace posture (a `write` flows: with review off it is
 * never asked, and with review on the hermetic environment's artifact
 * storage puts it on apply-then-review capture).
 */
export async function assertApprovalRoundTrip(harness: RuntimeContractHarness, label = "rt-approval"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label);
  const id = `${label}-shell`;
  const propose = scenario.propose(id, { kind: "shell", resource: `npm run build # ${label}` });

  const first = await driver.turn([propose]);
  expect(slimOf(subject, first).phase, `${subject.name}: a proposal returns WAITING_FOR_APPROVAL`).toBe("RUN_WAITING_FOR_APPROVAL");
  expect(driver.record.persistedPhases.at(-1)).toBe(RunPhase.RUN_WAITING_FOR_APPROVAL);
  expect(driver.record.waitingToolCalls().map((tc) => tc.id), `${subject.name}: exactly the proposal waits`).toEqual([id]);
  expect(subject.executionCount(id), `${subject.name}: a proposal never executes in its own turn`).toBe(0);
  const bindsAfterFirst = driver.record.harnessBinds.length;

  expect(driver.decide(ApprovalAction.APPROVE), `${subject.name}: one row to decide`).toBe(1);

  const second = await driver.turn([propose, scenario.say("Done.")]);
  expect(slimOf(subject, second).phase, `${subject.name}: after APPROVE the turn completes`).toBe("RUN_COMPLETED");
  expect(aiMessages(finalRowsOf(harness, driver)).at(-1)).toBe("Done.");
  expect(subject.executionCount(id), `${subject.name}: APPROVE executes exactly once`).toBe(1);
  expect(driver.record.waitingToolCalls(), `${subject.name}: nothing waits after the approval`).toHaveLength(0);
  expect(driver.record.harnessBinds, `${subject.name}: a resumed engine binds nothing new`).toHaveLength(bindsAfterFirst);
  return { driver, invocations: [first, second], final: finalStatusOf(harness, driver) };
}

// ── Arm: file review — capture, decide, undo by a reconcile turn ────────────

/**
 * Review across two runs — the runtime's own act for every harness
 * (`harness/capture.ts`; `harness/owed-undos.ts`), proven on a REAL git work
 * tree (the session's workspace directory IS the tree, so no harness needs a
 * workspace entry to reach it), in a session whose `file_review` is on.
 *
 * Turn 1: two writes FLOW (no gate row, each executed exactly once), and the
 * runtime — not the adapter — pins the baseline before the engine, captures
 * the candidate after it, badges the two flowed rows with the change set,
 * and the turn COMPLETES with both edits on the tree: review never holds a
 * turn (stigmer#1471). The ledger reads `[baseline, candidate]` under the
 * harness's own file-review identity, and the log carries one
 * `stigmer.file_review.changes` naming both files. Between runs the person
 * keeps one file and undoes the other (the record stands in for the
 * server's decision core: the decisions on the run, `decided` in the log),
 * and the decision core starts a reconcile turn. That run takes the short
 * path: the runtime never calls the adapter's `runTurn` (a guard adapter
 * counts it), the undone file is back at its baseline, the kept one holds
 * its bytes, one `stigmer.file_review.reconciled` names the undone path, and
 * the run settles COMPLETED with stop cause `review_resolved` and the
 * runtime's row naming the file put back.
 *
 * Content is the engine's own (a real `edit_file`, a real hook-allowed edit,
 * the fake's one line), so the arm asserts PATHS and the undo's effect on
 * disk, never bytes; the change kinds differ per engine (an engine that
 * seeds its ledger file before the turn produces a MODIFY where another
 * produces an ADD) and are not asserted either.
 */
export async function assertFileReviewRoundTrip(harness: RuntimeContractHarness, label = "rt-file-review"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label, { fileReview: true });
  initGitWorkspace(driver.workspaceDir, { "README.md": "# the kit's tree\n" });
  const keepId = `${label}-keep`;
  const dropId = `${label}-drop`;
  const KEPT = "kept.md";
  const DROPPED = "dropped.md";
  const changeSetId = `${driver.record.executionId}:0`;

  const first = await driver.turn([scenario.flowingWrite(keepId, KEPT), scenario.flowingWrite(dropId, DROPPED), scenario.say("Edited two files.")]);
  expect(slimOf(subject, first).phase, `${subject.name}: a turn with captured edits completes; review never holds it`).toBe("RUN_COMPLETED");
  expect(driver.record.waitingToolCalls(), `${subject.name}: a flowing write opens no gate row`).toHaveLength(0);
  expect(subject.executionCount(keepId), `${subject.name}: a flowing write executes at once`).toBe(1);
  expect(subject.executionCount(dropId)).toBe(1);
  expect(existsSync(join(driver.workspaceDir, KEPT)) && existsSync(join(driver.workspaceDir, DROPPED)), `${subject.name}: both writes landed on the tree`).toBe(true);

  const afterCapture = finalStatusOf(harness, driver);
  const afterCaptureRows = driver.record.rowsOf(afterCapture);
  const events = afterCaptureRows.fileReviewEventStream?.events ?? [];
  expect(events.map((e) => e.payload.case), `${subject.name}: the runtime authored the baseline and the candidate`).toEqual(["baselineCaptured", "candidateCaptured"]);
  const candidate = events[1]!.payload;
  if (candidate.case !== "candidateCaptured") throw new Error("unreachable");
  expect(candidate.value.changeSetId).toBe(changeSetId);
  expect([...candidate.value.changes.map((c) => c.pathAfter)].sort(), `${subject.name}: exactly the two written paths are reviewable`).toEqual([DROPPED, KEPT]);
  const baseline = events[0]!.payload;
  if (baseline.case !== "baselineCaptured") throw new Error("unreachable");
  expect(baseline.value.harnessId, `${subject.name}: the ledger carries this harness's file-review identity`).toBe(subject.adapter.capabilities.fileReview.harnessId);
  const rows = new Map(afterCaptureRows.messages.flatMap((m) => m.toolCalls).map((tc) => [tc.id, tc]));
  expect(rows.get(keepId)?.fileChangeSetId, `${subject.name}: a flowed row is badged with the change set`).toBe(changeSetId);
  expect(rows.get(dropId)?.fileChangeSetId).toBe(changeSetId);
  expect(rows.get(keepId)?.status, `${subject.name}: a flowed row is COMPLETED, never gated`).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
  // The strip is the runtime's, attached on its writes. Its COUNT is
  // the capture floor's (#1114); the arm asserts the ownership, not the floor.
  expect(afterCapture.fileChangeProgress?.changeSetId, `${subject.name}: the runtime carries this turn's strip`).toBe(changeSetId);
  expect(afterCapture.fileChanges.map((set) => set.id), `${subject.name}: the run's file record carries the captured change set`).toEqual([changeSetId]);
  expect([...afterCapture.fileChanges[0]!.changes.map((c) => c.pathAfter)].sort(), `${subject.name}: the file record holds both files`).toEqual([DROPPED, KEPT]);
  expect(afterCapture.completedAt, `${subject.name}: the turn is complete`).not.toBe("");
  const changes = driver.record.sessionEvents.flatMap((e) => (e.event.case === "stigmerFileReviewChanges" ? [e.event.value] : []));
  expect(changes.map((c) => c.changeSetId), `${subject.name}: one changes event for the change set`).toEqual([changeSetId]);
  expect([...changes[0]!.files.map((f) => f.path)].sort()).toEqual([DROPPED, KEPT]);

  const keptBytes = readFileSync(join(driver.workspaceDir, KEPT), "utf-8");
  expect(keptBytes).toContain(keepId);
  harness.clock.tick();
  expect(driver.record.decideCapturedFileChanges({ approve: [KEPT], reject: [DROPPED] }, new Date().toISOString()), `${subject.name}: two files to decide`).toBe(2);

  const { invocation: second, engineCalls } = await driver.reconcileTurn();
  expect(engineCalls, `${subject.name}: a reconcile turn never reaches the engine`).toBe(0);
  expect(slimOf(subject, second).phase, `${subject.name}: a reconcile turn completes`).toBe("RUN_COMPLETED");
  expect(subject.executionCount(keepId), `${subject.name}: the engine was not asked again`).toBe(1);
  expect(readFileSync(join(driver.workspaceDir, KEPT), "utf-8"), `${subject.name}: the kept file holds its bytes`).toBe(keptBytes);
  const droppedPath = join(driver.workspaceDir, DROPPED);
  expect(!existsSync(droppedPath) || !readFileSync(droppedPath, "utf-8").includes(dropId), `${subject.name}: the undone file is back at its baseline`).toBe(true);
  const final = driver.record.reconcileFinalStatus;
  if (final === undefined) throw new Error(`${subject.name}: the reconcile turn persisted no full status`);
  expect(final.stopCause, `${subject.name}: the reconcile turn's stop cause`).toBe("review_resolved");
  expect(systemMessages(driver.record.rowsOf(final)), `${subject.name}: the row names the file put back`).toContain(`${TERMINAL_COPY.fileReview.discardedPrefix}${DROPPED}.`);
  expect(final.completedAt).not.toBe("");
  const reconciled = driver.record.sessionEvents.flatMap((e) => (e.event.case === "stigmerFileReviewReconciled" ? [e] : []));
  expect(reconciled.map((e) => e.event.case === "stigmerFileReviewReconciled" && e.event.value.undonePaths), `${subject.name}: one reconciled event naming the undone path`).toEqual([[DROPPED]]);
  expect(reconciled[0]!.runId, `${subject.name}: written by the reconcile turn`).toBe(driver.record.reconcileRun?.metadata?.id);
  return { driver, invocations: [first, second], final };
}

/**
 * File review off (the default): a write flows with no capture, no gate row
 * and no ledger, and the turn completes with the edit on the tree. The
 * substrate is a real git work tree, so the only reason nothing is captured
 * is the switch.
 */
export async function assertFileReviewOffWriteFlows(harness: RuntimeContractHarness, label = "rt-review-off"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label);
  initGitWorkspace(driver.workspaceDir, { "README.md": "# the kit's tree\n" });
  const id = `${label}-write`;
  const invocation = await driver.turn([scenario.flowingWrite(id, "notes.md"), scenario.say("Wrote it.")]);
  expect(slimOf(subject, invocation).phase, `${subject.name}: the turn completes`).toBe("RUN_COMPLETED");
  expect(subject.executionCount(id), `${subject.name}: the write ran once, unasked`).toBe(1);
  expect(driver.record.waitingToolCalls(), `${subject.name}: no gate row`).toHaveLength(0);
  expect(existsSync(join(driver.workspaceDir, "notes.md")), `${subject.name}: the edit is on the tree`).toBe(true);
  const final = finalStatusOf(harness, driver);
  expect(driver.record.rowsOf(final).fileReviewEventStream?.events ?? [], `${subject.name}: nothing is captured with review off`).toHaveLength(0);
  expect(final.fileChanges, `${subject.name}: the run's file record is empty with review off`).toHaveLength(0);
  expect(driver.record.sessionEvents.some((e) => e.event.case === "stigmerFileReviewChanges"), `${subject.name}: no changes event`).toBe(false);
  return { driver, invocations: [invocation], final };
}

// ── Arm: awaiting_approval then deny ────────────────────────────────────────

/**
 * An answer that never runs the tool: the person denies the proposal, with
 * or without a reason (a skip and a reject are one deny since approvals
 * became session events); the reinvocation continues WITHOUT it — the
 * adapter's next step runs, the turn COMPLETES, the tool executes zero
 * times — and the runtime settles the row SKIPPED with
 * `error: "Rejected by user"`, so no WAITING row survives on a finished
 * execution. This is the proto contract as of stigmer#197 and the runtime's
 * own write (`harness/approval-decisions.ts`); before #1096 the runtime
 * FAILED a REJECTed reinvocation before any engine ran.
 */
export async function assertNonExecutingDecisionSettlesSkipped(
  harness: RuntimeContractHarness,
  denyMessage = "",
  label = denyMessage === "" ? "rt-deny" : "rt-deny-reason",
): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label);
  const id = `${label}-shell`;
  const propose = scenario.propose(id, { kind: "shell", resource: `rm -rf build # ${label}` });
  const verdict = "deni";
  const action = ApprovalAction.REJECT;

  const first = await driver.turn([propose]);
  expect(slimOf(subject, first).phase, `${subject.name}: a proposal returns WAITING_FOR_APPROVAL`).toBe("RUN_WAITING_FOR_APPROVAL");
  expect(driver.decide(action, denyMessage), `${subject.name}: one row to decide`).toBe(1);

  const second = await driver.turn([propose, scenario.say("Moving on.")]);
  expect(slimOf(subject, second).phase, `${subject.name}: after ${verdict} the run continues to COMPLETED — it does not fail`).toBe("RUN_COMPLETED");
  expect(aiMessages(finalRowsOf(harness, driver)).at(-1), `${subject.name}: the step after the ${verdict}ed action ran`).toBe("Moving on.");
  expect(subject.executionCount(id), `${subject.name}: a ${verdict}ed action never executes`).toBe(0);

  const final = finalStatusOf(harness, driver);
  const row = driver.record.rowsOf(final).messages.flatMap((m) => m.toolCalls).find((tc) => tc.id === id);
  expect(row, `${subject.name}: the decided row is carried on the transcript`).toBeDefined();
  expect(row!.status, `${subject.name}: the runtime settles a ${verdict}ed row SKIPPED`).toBe(ToolCallStatus.TOOL_CALL_SKIPPED);
  expect(row!.approvalAction, `${subject.name}: the decision stays legible on the settled row`).toBe(ApprovalAction.REJECT);
  expect(row!.error, `${subject.name}: a denied row carries the refusal`).toBe(REJECTED_BY_USER_ERROR);
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
 * the step after the limit never processed. Before #1096 the native harness
 * RETURNED this terminal without persisting it; the
 * runtime's arm is the one persisted terminal.
 *
 * The execution SETS the budget it exhausts: the record carries the smallest
 * valid `max_tool_rounds` (an unbounded execution has no limit to reach — on
 * native `resolveToolRoundLimit(0)` is unlimited, and the first run of this
 * arm against it spun until the test timed out). The fake
 * exhausts whatever budget it is given; a real engine spins its cheapest
 * ungated tool until the graph stops it.
 */
export async function assertToolCallLimitTerminates(harness: RuntimeContractHarness, label = "rt-tool-call-limit"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label, { maxToolRounds: MIN_TOOL_ROUNDS });
  const invocation = await driver.turn([scenario.say("Working…"), scenario.limit(), scenario.say(NEVER_SEEN)]);
  // `slimOf` is the RETURN assertion (a retry would spend the same budget).
  expect(slimOf(subject, invocation).phase, `${subject.name}: the tool-call limit is TERMINATED, not FAILED`).toBe("RUN_TERMINATED");
  const final = finalStatusOf(harness, driver);
  expect(final.phase).toBe(RunPhase.RUN_TERMINATED);
  expect(final.error.startsWith(TOOL_CALL_LIMIT_ERROR_PREFIX), `${subject.name}: the error carries the cross-repo prefix; got "${final.error}"`).toBe(true);
  expect(final.error, `${subject.name}: the copy is the table's, byte for byte`).toBe(formatToolCallLimitError());
  expect(systemMessages(driver.record.rowsOf(final)), `${subject.name}: the user copy is the one system row`).toEqual([TOOL_CALL_LIMIT_USER_COPY]);
  expect(final.completedAt, `${subject.name}: a TERMINATED turn completes`).not.toBe("");
  expect(aiMessages(driver.record.rowsOf(final)), `${subject.name}: the step after the limit is never processed`).not.toContain(NEVER_SEEN);
  expect(driver.record.persistedPhases.at(-1), `${subject.name}: the terminal is persisted, not merely returned`).toBe(RunPhase.RUN_TERMINATED);
  return { driver, invocations: [invocation], final };
}

// ── Arm: what a reinvocation carries ────────────────────────────────────────

/**
 * What a reinvocation carries forward, and what it does not. The status's
 * own outputs the prior invocation persisted — the write-back rows — are on
 * the completed status of the resumed turn, because the server takes each
 * list a write carries as the whole list, so a write holding only the
 * resumed turn's own would erase the prior turn's. The usage summary
 * carries until the resumed turn reports its own; a run resuming after an
 * approval then starts a fresh count, as `max_cost_usd`'s contract states
 * (a continuation keeps the run's: {@link assertContinuationCarriesTheRunsCount}). The transcript is not carried: the resumed turn's rows hold the
 * asked call it resumes onto, seeded once from the session's log
 * (`harness/transcript/resume-seed.ts`), and the rows it wrote itself, never an earlier
 * invocation's other rows. A first turn carries nothing, whatever the
 * record holds: the seed is gated on the log holding what the run's engine
 * did.
 *
 * The record here REPLACES its held status with every full write (stricter
 * than the server's merge), so a dropped list is a failing assertion, not a
 * masked one. The planted outputs are the prior turn's own, written onto the
 * record between invocations as the prior turn would have persisted them.
 */
export async function assertReinvocationCarriesThePersistedStatus(harness: RuntimeContractHarness, label = "rt-seed"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label);
  const id = `${label}-shell`;
  const propose = scenario.propose(id, { kind: "shell", resource: `make release # ${label}` });

  const first = await driver.turn([scenario.say("Releasing."), propose]);
  expect(slimOf(subject, first).phase).toBe("RUN_WAITING_FOR_APPROVAL");
  const planted = plantPriorTurnOutputs(driver.record.status!, label);
  expect(driver.decide(ApprovalAction.APPROVE)).toBe(1);

  const second = await driver.turn([propose, scenario.say("Done."), scenario.usage({ inputTokens: 100, outputTokens: 10, estimatedCostUsd: 0.0001, model: "fixture-model" })]);
  expect(slimOf(subject, second).phase, `${subject.name}: the resumed turn completes`).toBe("RUN_COMPLETED");
  const final = finalStatusOf(harness, driver);
  const rows = driver.record.rowsOf(final);
  expect(final.workspaceWriteBacks.map((w) => w.workspaceEntryName), `${subject.name}: the prior turn's write-back rows survive the resume`).toContain(planted.writeBackEntry);
  expect(final.streamingUsage?.inputTokens, `${subject.name}: a run resuming after an approval starts a fresh count`).toBe(100n);
  expect(rows.messages.flatMap((m) => m.toolCalls).filter((tc) => tc.id === id), `${subject.name}: the gated row is seeded once, not duplicated`).toHaveLength(1);
  expect(aiMessages(rows), `${subject.name}: the resumed turn's rows are its own; the prior turn's text is the log's`).toEqual(["Done."]);
  return { driver, invocations: [first, second], final };
}

/** The same record with the same planted outputs but nothing in the log: a first turn carries nothing. */
export async function assertFirstTurnSeedsNothing(harness: RuntimeContractHarness, label = "rt-seed-first"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label);
  plantPriorTurnOutputs(driver.record.status ?? (driver.record.execution.status = emptyStatus()), label);
  const invocation = await driver.turn([scenario.say("Fresh start.")]);
  expect(slimOf(subject, invocation).phase).toBe("RUN_COMPLETED");
  const final = finalStatusOf(harness, driver);
  expect(final.workspaceWriteBacks, `${subject.name}: a first turn carries no write-back rows`).toHaveLength(0);
  expect(driver.record.rowsOf(final).messages.flatMap((m) => m.toolCalls), `${subject.name}: a first turn seeds no rows`).toHaveLength(0);
  return { driver, invocations: [invocation], final };
}

/** Write the prior turn's outputs onto the server-held status, as its writes would have left them. */
function plantPriorTurnOutputs(held: RunStatus, label: string) {
  const planted = {
    writeBackEntry: `${label}-repo`,
    inputTokens: 4_242n,
  };
  held.workspaceWriteBacks.push(create(WorkspaceWriteBackSchema, { workspaceEntryName: planted.writeBackEntry, phase: WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_COMMITTED }));
  held.streamingUsage = create(StreamingUsageSummarySchema, { inputTokens: planted.inputTokens, totalTokens: planted.inputTokens });
  return planted;
}

// ── Arms: the stop controller's producers ───────────────────────────────────

/** A hanging scenario with the never-seen text after the hang; the arms below stop it in four different ways. */
function hangingTurn(before: string): TurnScenario {
  return [scenario.say(before), scenario.hang(), scenario.say(NEVER_SEEN)];
}

/**
 * An orchestrator stop (a user's Pause or Cancel, one cancellation to the
 * turn): Temporal's cancellation delivered while the engine hangs settles
 * the transcript into one write that carries no phase and no row (the
 * workflow writes both, stigmer#980), no error, no `completedAt`, and
 * THROWS the stop's `CancelledFailure` so the workflow sees the activity
 * stop.
 */
export async function assertOrchestratorStopSettlesAndThrows(
  harness: RuntimeContractHarness,
  label = "rt-orchestrator-stop",
): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label);
  let controls: InvocationControls | undefined;
  void subject.whenHanging().then(() => controls!.cancel());

  const invocation = await driver.turn(hangingTurn("Starting on the parser."), { onControls: (c) => (controls = c) });

  expect(threwCancelledFailure(invocation.outcome), `${subject.name}: an orchestrator stop THROWS a CancelledFailure`).toBe(true);
  if (!threwCancelledFailure(invocation.outcome)) throw new Error("unreachable");
  expect(invocation.outcome.error.message).toBe(TERMINAL_COPY.orchestratorStop.throwMessage);
  expect(
    driver.record.persistedPhases.at(-1),
    `${subject.name}: the stop writes no phase; the last phase is the turn's own`,
  ).toBe(RunPhase.RUN_IN_PROGRESS);
  const settle = driver.record.persisted.at(-1);
  if (!settle) throw new Error(`${subject.name}: the runtime persisted nothing`);
  expect(settle.phase, `${subject.name}: the settle write carries no phase`).toBe(RunPhase.RUN_PHASE_UNSPECIFIED);
  assertTranscriptStreamsNothing(subject.name, driver.record.rowsOf(settle));
  expect(settle.error, `${subject.name}: a stop is not an error`).toBe("");
  expect(settle.completedAt, `${subject.name}: a stopped turn is not complete`).toBe("");
  expect(systemMessages(driver.record.rowsOf(settle)), `${subject.name}: no stop row; the workflow writes it`).toEqual([]);
  expect(aiMessages(driver.record.rowsOf(settle))).not.toContain(NEVER_SEEN);
  return { driver, invocations: [invocation], final: settle };
}

/**
 * What every arm whose turn the workflow continues owes (`terminal-table.ts`,
 * "CONTINUE"): the settle write carries no phase, no error, no completion
 * stamp and no stop cause, so the run is still working and nothing terminal
 * reaches the server; and the session's log holds the turn's `note` (a
 * harness note) exactly once, or no note at all. Returns the settle write.
 */
function expectContinuesWithoutAnEnding(harness: RuntimeContractHarness, driver: RuntimeExecutionDriver, note: string | undefined): RunStatus {
  const { subject } = harness;
  expect(driver.record.persistedPhases.at(-1), `${subject.name}: no ending is written; the last phase is the turn's own`).toBe(RunPhase.RUN_IN_PROGRESS);
  const settle = driver.record.persisted.at(-1);
  if (!settle) throw new Error(`${subject.name}: the runtime persisted nothing`);
  expect(settle.phase, `${subject.name}: the settle write carries no phase`).toBe(RunPhase.RUN_PHASE_UNSPECIFIED);
  assertTranscriptStreamsNothing(subject.name, driver.record.rowsOf(settle));
  expect(settle.error, `${subject.name}: a turn that continues is not an error`).toBe("");
  expect(settle.completedAt, `${subject.name}: a turn that continues is not complete`).toBe("");
  expect(settle.stopCause, `${subject.name}: a turn that continues has not stopped`).toBe("");
  expect(systemMessages(driver.record.rowsOf(settle)), `${subject.name}: the turn's note and no stop row`).toEqual(note === undefined ? [] : [note]);
  expect(harnessNotesOf(driver), `${subject.name}: the session's log says why the turn moved, once`).toEqual(note === undefined ? [] : [note]);
  return settle;
}

/** The texts of the harness notes on the run's session log, in order. */
function harnessNotesOf(driver: RuntimeExecutionDriver): string[] {
  return driver.record.sessionEvents.flatMap((e) => (e.event.case === "stigmerHarnessNote" ? [e.event.value.text] : []));
}

/**
 * A worker shutdown past the drain grace: the queue's drain signal aborts,
 * then Temporal stops the turn mid-step (the cancellation the drain's
 * signal marks). The workflow continues the turn on the next runner, so
 * nothing terminal is written (stigmer#2428), the drain's note says why the
 * turn moved, and the shutdown `CancelledFailure` is thrown.
 */
export async function assertWorkerShutdownContinuesAndThrows(harness: RuntimeContractHarness, label = "rt-shutdown"): Promise<RuntimeArmResult> {
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
  const settle = expectContinuesWithoutAnEnding(harness, driver, TERMINAL_COPY.continuation.notes.drain);
  expect(aiMessages(driver.record.rowsOf(settle))).not.toContain(NEVER_SEEN);
  return { driver, invocations: [invocation], final: settle };
}

/**
 * An infrastructure cancel: Temporal cancels for its own reason (a heartbeat
 * timeout, `TIMED_OUT`), neither the workflow's stop nor the runner's drain.
 * The workflow has already counted the activity lost and continues the turn
 * elsewhere, so nothing terminal is written and no note (this runner may be
 * the one that stopped answering); the heartbeat-timeout `CancelledFailure`
 * is thrown.
 */
export async function assertInfrastructureCancelContinuesAndThrows(
  harness: RuntimeContractHarness,
  label = "rt-infrastructure-cancel",
): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label);
  let controls: InvocationControls | undefined;
  void subject.whenHanging().then(() => controls!.cancelTimedOut());

  const invocation = await driver.turn(hangingTurn("Starting on the parser."), { onControls: (c) => (controls = c) });

  expect(threwCancelledFailure(invocation.outcome), `${subject.name}: an infrastructure cancel THROWS a CancelledFailure`).toBe(true);
  if (!threwCancelledFailure(invocation.outcome)) throw new Error("unreachable");
  expect(invocation.outcome.error.message).toBe(TERMINAL_COPY.infrastructureCancel.throwMessage);
  const settle = expectContinuesWithoutAnEnding(harness, driver, undefined);
  expect(aiMessages(driver.record.rowsOf(settle))).not.toContain(NEVER_SEEN);
  return { driver, invocations: [invocation], final: settle };
}

/** How often the stall arm's clock advances once the engine is parked; real time between scripted windows. */
const STALL_CLOCK_INTERVAL_MS = 25;

/**
 * A stall with nothing owed by the model, an engine wedged before it did
 * anything: the watchdog measures idle time on the scripted clock; while the
 * engine hangs the clock KEEPS RUNNING — a stall window per interval until
 * the turn settles — and the first window with no activity fails the turn
 * (RETURNED — a retry would wedge again) with the watchdog's copy naming the
 * idle seconds. A stall while the turn waits on its model continues instead
 * ({@link assertModelStallContinues}).
 *
 * Why the clock runs rather than ticks once: on a push-based engine the
 * park is reported while the chunks the engine produced before parking are
 * still in its event pipeline ahead of the adapter's loop, so activity marks
 * land AFTER a single tick and a frozen clock reads idle 0 from then on
 * (measured on the native adapter: 35 marks at the park, 37
 * within 10 ms). A pull-based double's park implies everything before it
 * was seen; a real stall is wall time passing while the engine is silent,
 * whichever shape the engine has. The interval advances a SCRIPTED clock —
 * the kit's rule against timers is about stopping a turn on a guess, which
 * this never does.
 */
export async function assertStallFailsTheTurn(harness: RuntimeContractHarness, label = "rt-stall"): Promise<RuntimeArmResult> {
  const { subject, clock } = harness;
  const driver = new RuntimeExecutionDriver(harness, label);
  let running: NodeJS.Timeout | undefined;
  void subject.whenHanging().then(() => {
    clock.tick(STALL_TIMEOUT_MS);
    running = setInterval(() => clock.tick(STALL_TIMEOUT_MS), STALL_CLOCK_INTERVAL_MS);
  });

  let invocation: ActivityInvocation;
  try {
    invocation = await driver.turn([scenario.hang(), scenario.say(NEVER_SEEN)], { config: { cursorStreamStallTimeoutMs: STALL_TIMEOUT_MS } });
  } finally {
    if (running) clearInterval(running);
  }

  expect(slimOf(subject, invocation).phase, `${subject.name}: a stall RETURNS FAILED`).toBe("RUN_FAILED");
  expect(driver.record.persistedPhases.at(-1)).toBe(RunPhase.RUN_FAILED);
  const final = finalStatusOf(harness, driver);
  expect(final.error).toMatch(/^\[StallTimeoutError\] Agent stream stalled: no activity for \d+s( \(last tool: [^)]+\))?\. Retry or resume\.$/);
  expect(systemMessages(driver.record.rowsOf(final))).toHaveLength(1);
  expect(systemMessages(driver.record.rowsOf(final))[0]).toMatch(
    /^Execution failed: the agent made no progress for too long and was stopped \(Agent stream stalled: no activity for \d+s( \(last tool: [^)]+\))?\)\. You can retry or resume\.$/,
  );
  expect(final.completedAt).not.toBe("");
  expect(aiMessages(driver.record.rowsOf(final))).not.toContain(NEVER_SEEN);
  return { driver, invocations: [invocation], final };
}

/**
 * A stall while the turn waits on its model: a tool's result went to the
 * model and nothing came back for the window. The provider's, not the
 * engine's, so nothing terminal is written, the note says why, the typed
 * continuation tells the workflow to run the turn again, and the next
 * invocation asks the model again from where the turn was, never handing it
 * the task. The clock runs as in {@link assertStallFailsTheTurn}.
 */
export async function assertModelStallContinues(harness: RuntimeContractHarness, label = "rt-model-stall"): Promise<RuntimeArmResult> {
  const { subject, clock } = harness;
  const controls = longTurnOf(subject);
  const driver = new RuntimeExecutionDriver(harness, label);
  const read = `${label}-read`;
  let running: NodeJS.Timeout | undefined;
  void subject.whenHanging().then(() => {
    clock.tick(STALL_TIMEOUT_MS);
    running = setInterval(() => clock.tick(STALL_TIMEOUT_MS), STALL_CLOCK_INTERVAL_MS);
  });

  let first: ActivityInvocation;
  try {
    first = await driver.turn([scenario.say("Reading the config."), scenario.read(read, "package.json"), scenario.hang(), scenario.say(NEVER_SEEN)], {
      config: { cursorStreamStallTimeoutMs: STALL_TIMEOUT_MS },
    });
  } finally {
    if (running) clearInterval(running);
  }

  expect(continuationCauseOf(first.outcome), `${subject.name}: a stall owed by the model continues`).toBe("model-stall");
  const settle = expectContinuesWithoutAnEnding(harness, driver, TERMINAL_COPY.continuation.notes["model-stall"]);
  expect(aiMessages(driver.record.rowsOf(settle))).not.toContain(NEVER_SEEN);

  const second = await driver.turn([scenario.read(read, "package.json"), scenario.say("The config is read.")]);
  expectCompleted(harness, driver, second, "The config is read.");
  expect(harnessNotesOf(driver), `${subject.name}: the stall's note, once`).toEqual([TERMINAL_COPY.continuation.notes["model-stall"]]);
  expect(controls.tasksHanded(driver.sessionId, RUNTIME_USER_MESSAGE), `${subject.name}: the engine was handed the task once`).toBe(1);
  return { driver, invocations: [first, second], final: finalStatusOf(harness, driver) };
}

/**
 * The engine's vendor ends its connection mid-turn (Cursor's backend ends a
 * long run's stream, stigmer#2436): no stop of the runtime's caused it, and
 * the vendor kept the conversation, so nothing terminal is written, the note
 * says why, the typed continuation tells the workflow to run the turn again,
 * and the next invocation picks up from where the turn was, never handing
 * the engine the task.
 */
export async function assertStreamCutContinues(harness: RuntimeContractHarness, label = "rt-stream-cut"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const controls = longTurnOf(subject);
  const driver = new RuntimeExecutionDriver(harness, label);
  const read = `${label}-read`;

  const first = await driver.turn([scenario.say("Reading the config."), scenario.read(read, "package.json"), scenario.cut(), scenario.say(NEVER_SEEN)]);

  expect(continuationCauseOf(first.outcome), `${subject.name}: a cut the vendor made continues`).toBe("stream-cut");
  const settle = expectContinuesWithoutAnEnding(harness, driver, TERMINAL_COPY.continuation.notes["stream-cut"]);
  expect(aiMessages(driver.record.rowsOf(settle))).not.toContain(NEVER_SEEN);

  const second = await driver.turn([scenario.read(read, "package.json"), scenario.say("The config is read.")]);
  expectCompleted(harness, driver, second, "The config is read.");
  expect(harnessNotesOf(driver), `${subject.name}: the cut's note, once`).toEqual([TERMINAL_COPY.continuation.notes["stream-cut"]]);
  expect(controls.tasksHanded(driver.sessionId, RUNTIME_USER_MESSAGE), `${subject.name}: the engine was handed the task once`).toBe(1);
  return { driver, invocations: [first, second], final: finalStatusOf(harness, driver) };
}

/**
 * A turn the platform STOPs after a write landed: the turn completes early,
 * and what it left on the tree is a change set to keep or undo, captured
 * when the stop's arm returned (#1115). Before it, those edits sat on the
 * tree with nothing to decide.
 */
export async function assertStoppedTurnCapturesItsEdits(harness: RuntimeContractHarness, label = "rt-stop-captures"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const writeId = `${label}-write`;
  const WRITTEN = "stopped.md";
  const driver = new RuntimeExecutionDriver(harness, label, {
    fileReview: true,
    controlSignal: (_status, rows) =>
      findToolCallRow(rows, writeId)?.status === ToolCallStatus.TOOL_CALL_COMPLETED ? RunControlSignal.STOP : RunControlSignal.UNSPECIFIED,
  });
  initGitWorkspace(driver.workspaceDir, { "README.md": "# the kit's tree\n" });
  const changeSetId = `${driver.record.executionId}:0`;

  const invocation = await driver.turn([scenario.flowingWrite(writeId, WRITTEN), scenario.say(NEVER_SEEN)]);

  expect(slimOf(subject, invocation).phase, `${subject.name}: a platform STOP completes the turn`).toBe("RUN_COMPLETED");
  const final = finalStatusOf(harness, driver);
  expect(final.fileChanges.map((set) => set.id), `${subject.name}: the stopped turn's edits are a change set`).toEqual([changeSetId]);
  expect(final.fileChanges[0]!.changes.map((c) => c.pathAfter), `${subject.name}: the written file is reviewable`).toEqual([WRITTEN]);
  const changes = driver.record.sessionEvents.flatMap((e) => (e.event.case === "stigmerFileReviewChanges" ? [e.event.value] : []));
  expect(changes.map((c) => c.changeSetId), `${subject.name}: the log offers it for a decision`).toEqual([changeSetId]);
  return { driver, invocations: [invocation], final };
}

/**
 * A turn drained between two writes and continued: one change set for the
 * whole turn, under the first invocation's id and baseline, holding both
 * files. The continued invocation adopts the open set instead of pinning a
 * second baseline that would fold the first write into its "before"
 * (#1115).
 */
export async function assertContinuedTurnKeepsOneChangeSet(harness: RuntimeContractHarness, label = "rt-one-change-set"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const controls = longTurnOf(subject);
  const driver = new RuntimeExecutionDriver(harness, label, { fileReview: true, autoApproveAll: true });
  initGitWorkspace(driver.workspaceDir, { "README.md": "# the kit's tree\n" });
  const beforeId = `${label}-before`;
  const afterId = `${label}-after`;
  const build = `${label}-build`;
  const BEFORE = "before.md";
  const AFTER = "after.md";
  const changeSetId = `${driver.record.executionId}:0`;
  let invocationControls: InvocationControls | undefined;
  const draining = controls.whenOpen(build).then(async () => {
    invocationControls!.signalWorkerShutdown();
    await theYieldHasCrossed();
    await controls.release(build);
  });

  const first = await driver.turn([scenario.flowingWrite(beforeId, BEFORE), scenario.open(build), scenario.say(NEVER_SEEN)], {
    onControls: (c) => (invocationControls = c),
  });
  await draining;
  expect(continuationCauseOf(first.outcome), `${subject.name}: the drained invocation continues`).toBe("drain");

  const second = await driver.turn([scenario.flowingWrite(beforeId, BEFORE), scenario.open(build), scenario.flowingWrite(afterId, AFTER), scenario.say("Both files are written.")]);
  expectCompleted(harness, driver, second, "Both files are written.");
  const final = finalStatusOf(harness, driver);
  expect(final.fileChanges.map((set) => set.id), `${subject.name}: one change set for the whole turn`).toEqual([changeSetId]);
  expect([...final.fileChanges[0]!.changes.map((c) => c.pathAfter)].sort(), `${subject.name}: both invocations' files, against the turn's first baseline`).toEqual([AFTER, BEFORE]);
  return { driver, invocations: [first, second], final };
}

/**
 * The cost cap: usage the adapter priced above the message's budget
 * TERMINATES the turn with the budget copy, the priced sum on the status,
 * and the step after the overrun never processed. The budget is the one the
 * control plane resolved (`status.run_config`); the request asks for a far
 * larger one (`spec.run_config`), which the runtime must not read.
 */
export async function assertCostCapTerminates(harness: RuntimeContractHarness, label = "rt-cost-cap"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label, {
    maxCostUsd: COST_CAP_BUDGET_USD,
    requestRunConfig: create(RunConfigSchema, { maxCostUsd: COST_CAP_BUDGET_USD * 1_000 }),
  });

  const invocation = await driver.turn([
    scenario.say("Reading the whole repository first."),
    scenario.usage({ inputTokens: COST_CAP_INPUT_TOKENS, outputTokens: 0, estimatedCostUsd: COST_CAP_FAKE_PRICE_USD, model: "fixture-model" }),
    scenario.say(NEVER_SEEN),
  ]);

  expect(slimOf(subject, invocation).phase, `${subject.name}: the cost cap TERMINATES`).toBe("RUN_TERMINATED");
  expect(driver.record.persistedPhases.at(-1)).toBe(RunPhase.RUN_TERMINATED);
  const final = finalStatusOf(harness, driver);
  expect(final.error).toMatch(/^Agent reached the cost limit for this message \(~\$[\d.]+ of the \$0\.50 budget\)\. Send another message to continue\.$/);
  expect(systemMessages(driver.record.rowsOf(final))).toEqual([
    "The agent reached the cost limit for this message. Work completed so far has been saved. " +
      "Send another message to continue where the agent left off.",
  ]);
  expect(final.streamingUsage?.estimatedCostUsd ?? 0, `${subject.name}: the priced usage is above the budget`).toBeGreaterThan(COST_CAP_BUDGET_USD);
  expect(aiMessages(driver.record.rowsOf(final))).not.toContain(NEVER_SEEN);
  return { driver, invocations: [invocation], final };
}

/**
 * A platform STOP answered to a mid-turn persist: the turn completes early
 * with the platform-stop row and no error, and the step after the STOP never
 * runs — the awaited `requestPersist` at work. The persist the
 * control plane answers is the one carrying a completed `read`: the discrete
 * event every harness flushes on (the Cursor golden's lever), where a bare
 * assistant message may ride an engine's cadence to the settle persist, too
 * late to stop anything.
 */
export async function assertPlatformStopCompletesEarly(harness: RuntimeContractHarness, label = "rt-platform-stop"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label, {
    controlSignal: (_status, rows) =>
      rows.messages.some((m) => m.toolCalls.some((tc) => tc.status === ToolCallStatus.TOOL_CALL_COMPLETED))
        ? RunControlSignal.STOP
        : RunControlSignal.UNSPECIFIED,
  });

  const invocation = await driver.turn([scenario.say("Starting the suite."), scenario.read(`${label}-read`, "package.json"), scenario.say(NEVER_SEEN)]);

  expect(slimOf(subject, invocation).phase, `${subject.name}: a platform STOP completes the turn`).toBe("RUN_COMPLETED");
  expect(driver.record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);
  const final = finalStatusOf(harness, driver);
  expect(final.error, `${subject.name}: a platform stop is not an error`).toBe("");
  expect(systemMessages(driver.record.rowsOf(final))).toEqual([TERMINAL_COPY.platformStop.row]);
  expect(aiMessages(driver.record.rowsOf(final)), `${subject.name}: the step after the STOP never runs`).toEqual(["Starting the suite."]);
  return { driver, invocations: [invocation], final };
}

// ── Arms: the engine ends its own run ───────────────────────────────────────

/** An engine-cancelled run ends CANCELLED: no error, no copy, stamped. */
export async function assertEngineCancelledEndsCancelled(harness: RuntimeContractHarness, label = "rt-cancelled"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label);

  const invocation = await driver.turn([scenario.say("Looking at the pull requests."), scenario.cancelled(), scenario.say(NEVER_SEEN)]);

  const slim = slimOf(subject, invocation);
  expect(slim.phase, `${subject.name}: an engine cancel ends CANCELLED`).toBe("RUN_CANCELLED");
  expect(driver.record.persistedPhases.at(-1)).toBe(RunPhase.RUN_CANCELLED);
  const final = finalStatusOf(harness, driver);
  expect(final.error).toBe("");
  expect(final.completedAt).not.toBe("");
  expect(systemMessages(driver.record.rowsOf(final))).toEqual([]);
  expect(aiMessages(driver.record.rowsOf(final))).not.toContain(NEVER_SEEN);
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

  expect(slimOf(subject, invocation).phase, `${subject.name}: a ${surface} failure RETURNS FAILED`).toBe("RUN_FAILED");
  expect(driver.record.persistedPhases.at(-1)).toBe(RunPhase.RUN_FAILED);
  const final = finalStatusOf(harness, driver);
  expect(final.error, `${subject.name}: a failed turn names its error`).not.toBe("");
  expect(final.completedAt).not.toBe("");
  const rows = systemMessages(driver.record.rowsOf(final));
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
  expect(aiMessages(driver.record.rowsOf(final))).not.toContain(NEVER_SEEN);
  return { driver, invocations: [invocation], final };
}

// ── Arms: failures before or around the engine ──────────────────────────────

/**
 * A rejected `bindHarnessState` (the session write refused) ends the turn
 * FAILED on the internal surface with nothing executed.
 * Engine-minted harnesses only: a deterministic one never binds.
 */
export async function assertRejectedBindFails(harness: RuntimeContractHarness, label = "rt-bind-rejects"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label);

  const invocation = await driver.turn([scenario.say(NEVER_SEEN)], {
    clientOverrides: {
      bindHarnessState: async () => {
        throw new Error("session write refused");
      },
    },
  });

  expect(slimOf(subject, invocation).phase, `${subject.name}: a rejected bind RETURNS FAILED`).toBe("RUN_FAILED");
  const final = finalStatusOf(harness, driver);
  expect(final.error).not.toBe("");
  expect(systemMessages(driver.record.rowsOf(final))[0], `${subject.name}: a rejected bind is an internal failure`).toBe(TERMINAL_COPY.internalFailure.row);
  expect(aiMessages(driver.record.rowsOf(final)), `${subject.name}: nothing ran after the rejected bind`).not.toContain(NEVER_SEEN);
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
      getSession: async () => {
        throw new Error("runtime fault injected at getSession");
      },
    },
  });

  expect(slimOf(subject, invocation).phase).toBe("RUN_FAILED");
  expect(driver.record.persistedPhases, `${subject.name}: nothing was persisted before the failure`).toEqual([RunPhase.RUN_FAILED]);
  const final = finalStatusOf(harness, driver);
  // One grammar for a FAILED `status.error` (stigmer#1122): the described
  // fault, unframed, exactly what the details row carries.
  expect(final.error).toBe("[Error] runtime fault injected at getSession");
  expect(systemMessages(driver.record.rowsOf(final))).toEqual([TERMINAL_COPY.internalFailure.row, `Error details: ${final.error}`]);
  expect(driver.record.setupProgress).toEqual(["Fetching execution", "Resolving agent blueprint"]);
  expect(driver.record.harnessBinds).toHaveLength(0);
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

    expect(slimOf(subject, invocation).phase).toBe("RUN_FAILED");
    expect(driver.record.persistedPhases).toEqual([RunPhase.RUN_FAILED]);
    const final = finalStatusOf(harness, driver);
    const resolvedDir = await realpath(driver.workspaceDir);
    expect(final.error).toContain(`Workspace is in use by another session: ${resolvedDir}`);
    expect(systemMessages(driver.record.rowsOf(final))).toEqual([`Execution failed: ${final.error}`]);
    expect(driver.record.setupProgress.at(-1)).toBe("Waiting for workspace — in use by another session");
    expect(driver.record.harnessBinds).toHaveLength(0);
    return { driver, invocations: [invocation], final };
  } finally {
    await release();
  }
}

// ── Arms: the long turn ─────────────────────────────────────────────────────
//
// What a turn that works for hours owes the user, stated as the behaviour the
// user should get. Several are not true today on some harness; a subject's
// registration names the issue for each arm that is a known gap there
// (`RuntimeContractOptions.knownGaps`), and the arm then passes while the
// gap's own outcome holds and fails the day it closes (`../known-gap.ts`).
//
// Time is the scripted clock's, as in the stall arm: once the subject reports
// the operation running (`whenOpen`), the arm advances the clock by stall
// windows and lets one real watchdog poll pass, so "ten silent minutes" is
// three windows and about a second. Every arm runs with the record's
// whole-run trust (`autoApproveAll`), the product's own "trust this whole
// run", because a native shell is gated in every other posture.

/** How many stall windows an open operation lasts: the "ten silent minutes" of a long build, at three times the window. */
export const LONG_OPERATION_WINDOWS = 3;

/** The arms of the long turn, by the name a registration's `knownGaps` keys them on. */
export type LongTurnArm = "silent-operation" | "streamed-output" | "subagent-operation" | "three-compactions";

/** The saved agent the subagent arm's agent lists (`types.ts` names it). */
const KIT_SUBAGENT = savedAgentFixture(KIT_SUBAGENT_SLUG, { description: "Does the contract kit's delegated work.", instructions: KIT_SUBAGENT_INSTRUCTIONS });

/** How long a status write takes in the slow-log arm: long enough for an engine left to run past its boundary to finish the turn. */
const SLOW_LOG_WRITE_MS = 300;

/** Real time for one watchdog poll (a quarter of the window) to pass, with margin. */
function oneWatchdogPoll(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, STALL_TIMEOUT_MS / 4 + 100));
}

/**
 * The operation runs silent for {@link LONG_OPERATION_WINDOWS} windows. Half
 * a window and a poll first: on a push-based engine the marks it made before
 * the operation opened are still in its pipeline when the subject reports it
 * open (the stall arm's measurement), and they must land before the silence
 * is measured, or they reset the idle time and the arm proves nothing.
 */
async function silentFor(clock: ScriptedClock): Promise<void> {
  clock.tick(STALL_TIMEOUT_MS / 2);
  await oneWatchdogPoll();
  clock.tick(LONG_OPERATION_WINDOWS * STALL_TIMEOUT_MS);
  await oneWatchdogPoll();
}

/** `closing` ends the transcript's last assistant text: the turn played on after the operation (an engine may fold consecutive texts into one message). */
function endsWithText(closing: string): RegExp {
  return new RegExp(`${closing.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

function longTurnOf(subject: HarnessContractSubject): LongTurnControls {
  if (!subject.longTurn) throw new Error(`${subject.name}: a long-turn arm ran on a subject with no long-turn controls (kit bug: declare the arm off, or give the subject \`longTurn\`)`);
  return subject.longTurn;
}

/** The mark for one arm on this subject, with the arm's own statement of today's outcome. */
function gapFor(issue: string | undefined, today: TodayOutcome): KnownGap | undefined {
  return issue ? { issue, today } : undefined;
}

/** Today's outcome every liveness gap shares: the watchdog failed the turn while the operation ran. */
function endedOnTheStall(driver: RuntimeExecutionDriver): TodayOutcome {
  return {
    says: "the stall watchdog fails the turn while the operation runs",
    holds: () => /^\[StallTimeoutError\] /.test(driver.record.lastFullStatus?.error ?? "") && driver.record.persistedPhases.at(-1) === RunPhase.RUN_FAILED,
  };
}

/**
 * One turn that opens `toolCallId` and plays on after it: the arm's `drive`
 * runs once the subject reports the operation running, then the operation is
 * released. A turn that settles before the operation ever ran fails the arm,
 * named: the arm would otherwise measure the wrong thing.
 */
async function turnWithOpenOperation(
  harness: RuntimeContractHarness,
  driver: RuntimeExecutionDriver,
  turn: TurnScenario,
  toolCallId: string,
  drive: (controls: LongTurnControls) => Promise<void>,
  config: Partial<Config> = {},
): Promise<ActivityInvocation> {
  const { subject } = harness;
  const controls = longTurnOf(subject);
  const settled = driver.turn(turn, { config: { cursorStreamStallTimeoutMs: STALL_TIMEOUT_MS, ...config } });
  let opened = false;
  const driving = Promise.race([controls.whenOpen(toolCallId).then(() => true), settled.then(() => false, () => false)]).then(async (running) => {
    opened = running;
    if (running) await drive(controls);
    await controls.release(toolCallId);
  });
  const invocation = await settled;
  await controls.release(toolCallId);
  await driving;
  if (!opened) throw new Error(`${subject.name}: the turn settled before the operation '${toolCallId}' ever ran`);
  return invocation;
}

/** The desired end of every long-turn arm: the turn completes, its closing text on the transcript, no error. */
function expectCompleted(harness: RuntimeContractHarness, driver: RuntimeExecutionDriver, invocation: ActivityInvocation, closing: string): void {
  const { subject } = harness;
  expect(slimOf(subject, invocation).phase, `${subject.name}: the turn completes`).toBe("RUN_COMPLETED");
  const final = finalStatusOf(harness, driver);
  expect(final.error, `${subject.name}: a completed turn carries no error`).toBe("");
  expect(aiMessages(driver.record.rowsOf(final)).at(-1), `${subject.name}: the turn played on after the operation`).toMatch(endsWithText(closing));
}

/**
 * A silent operation outlives the stall window: a build that prints nothing
 * for three windows is work, not a wedge, and the turn completes when it
 * finishes. Today the watchdog measures only stream events, so an open
 * operation that says nothing reads as a stall.
 */
export async function assertSilentOperationOutlivesTheStallWindow(harness: RuntimeContractHarness, gap?: string, label = "rt-silent-operation"): Promise<RuntimeArmResult> {
  const { clock } = harness;
  const driver = new RuntimeExecutionDriver(harness, label, { autoApproveAll: true });
  const id = `${label}-build`;
  const invocation = await turnWithOpenOperation(harness, driver, [scenario.say("Building."), scenario.open(id), scenario.say("Built.")], id, () => silentFor(clock));
  await expectKnownGap(gapFor(gap, endedOnTheStall(driver)), () => expectCompleted(harness, driver, invocation, "Built."));
  return { driver, invocations: [invocation], final: finalStatusOf(harness, driver) };
}

/**
 * Output streams while an operation runs: each line the operation prints
 * goes out to the session as a `stigmer.tool_output_delta` preview before the
 * operation's result, and a line per window keeps the turn alive, so it
 * completes. The lines are the user's only sign the build is moving.
 */
export async function assertStreamedOutputReachesTheSession(harness: RuntimeContractHarness, gap?: string, label = "rt-streamed-output"): Promise<RuntimeArmResult> {
  const { clock, subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label, { autoApproveAll: true });
  const id = `${label}-build`;
  const lines = Array.from({ length: LONG_OPERATION_WINDOWS + 1 }, (_, i) => `compiling module ${i + 1}`);
  const invocation = await turnWithOpenOperation(harness, driver, [scenario.say("Building."), scenario.open(id, { streams: true }), scenario.say("Built.")], id, async (controls) => {
    // A line, then three quarters of a window: the operation is never silent
    // for a whole window, and the lines span three windows in all.
    for (const line of lines) {
      await controls.emit(id, line);
      clock.tick((STALL_TIMEOUT_MS * 3) / 4);
      await oneWatchdogPoll();
    }
  });
  const streamed = (): string =>
    driver.record.sessionPreviews.flatMap((p) => (p.preview.case === "stigmerToolOutputDelta" ? [p.preview.value.delta] : [])).join("");
  await expectKnownGap(
    gapFor(gap, {
      says: "no line the operation prints reaches the session while it runs",
      holds: () => !lines.some((line) => streamed().includes(line)),
    }),
    () => {
      for (const line of lines) expect(streamed(), `${subject.name}: '${line}' went out as a tool-output preview`).toContain(line);
      expectCompleted(harness, driver, invocation, "Built.");
    },
  );
  return { driver, invocations: [invocation], final: finalStatusOf(harness, driver) };
}

/**
 * A subagent outlives the stall window: delegated work that takes three
 * windows is work, and the parent's turn completes when the subagent
 * answers. Today the parent's stream is silent while its subagent thinks.
 */
export async function assertSubagentOutlivesTheStallWindow(harness: RuntimeContractHarness, gap?: string, label = "rt-subagent-operation"): Promise<RuntimeArmResult> {
  const { clock } = harness;
  const driver = new RuntimeExecutionDriver(harness, label, { autoApproveAll: true, subagents: [KIT_SUBAGENT] });
  const id = `${label}-task`;
  const invocation = await turnWithOpenOperation(harness, driver, [scenario.say("Delegating."), scenario.open(id, { as: "subagent" }), scenario.say("Delegated work is in.")], id, () => silentFor(clock));
  await expectKnownGap(gapFor(gap, endedOnTheStall(driver)), () => expectCompleted(harness, driver, invocation, "Delegated work is in."));
  return { driver, invocations: [invocation], final: finalStatusOf(harness, driver) };
}

/** The liveness interval the liveness arm runs under: real time, several sends inside the arm's silent windows. */
export const KIT_LIVENESS_INTERVAL_MS = 200;

/**
 * A working turn says what it is doing: while an operation runs silent, the
 * runtime sends `stigmer.run.liveness` previews at its interval, each naming
 * the operation by the id of its tool use in the log and how long it has been
 * open, and the age grows from one to the next. Each goes in an append of its
 * own, so a server older than the preview, which refuses it, never costs a
 * stored event. Without them the console can only guess from silence whether
 * a ten-minute build is alive (`SlowIndicator`).
 */
export async function assertLivenessNamesTheOpenOperation(harness: RuntimeContractHarness, label = "rt-liveness"): Promise<RuntimeArmResult> {
  const { clock, subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label, { autoApproveAll: true });
  const id = `${label}-build`;
  const invocation = await turnWithOpenOperation(
    harness,
    driver,
    [scenario.say("Building."), scenario.open(id), scenario.say("Built.")],
    id,
    () => silentFor(clock),
    { livenessIntervalMs: KIT_LIVENESS_INTERVAL_MS },
  );
  const record = driver.record;
  const liveness = record.sessionPreviews.flatMap((p) => (p.preview.case === "stigmerRunLiveness" ? [p.preview.value] : []));
  const naming = liveness.filter((frame) => frame.operations.length > 0);
  expect(naming.length, `${subject.name}: the open operation is named at the interval while it runs`).toBeGreaterThanOrEqual(2);
  const useIds = new Set(
    record.sessionEvents.flatMap((e) => (e.event.case === "agentToolUse" || e.event.case === "agentMcpToolUse" ? [e.event.value.id] : [])),
  );
  for (const frame of naming) {
    expect(frame.runId, `${subject.name}: a liveness names its run`).toBe(record.executionId);
    for (const operation of frame.operations) {
      expect(useIds.has(operation.toolUseId), `${subject.name}: '${operation.toolUseId}' is a tool use the log holds`).toBe(true);
      expect(operation.name, `${subject.name}: an operation carries its tool's name`).not.toBe("");
    }
  }
  const ageMs = (frame: (typeof naming)[number]): number => Number(frame.operations[0]?.elapsed?.seconds ?? 0n) * 1000;
  expect(ageMs(naming.at(-1)!), `${subject.name}: the age grows while the operation runs`).toBeGreaterThan(ageMs(naming[0]!));
  expect(ageMs(naming.at(-1)!), `${subject.name}: the age reaches the silent windows`).toBeGreaterThanOrEqual(LONG_OPERATION_WINDOWS * STALL_TIMEOUT_MS);
  for (const shape of record.appendShapes) {
    if (!shape.previews.includes("stigmerRunLiveness")) continue;
    expect(shape, `${subject.name}: a liveness travels alone`).toEqual({ events: 0, previews: ["stigmerRunLiveness"] });
  }
  expectCompleted(harness, driver, invocation, "Built.");
  return { driver, invocations: [invocation], final: finalStatusOf(harness, driver) };
}

/** The backstop the operation-limit arm runs under: past the three windows a long operation lasts, so only the backstop can end it. */
export const KIT_OPEN_OPERATION_MAX_MS = (LONG_OPERATION_WINDOWS + 1) * STALL_TIMEOUT_MS;

/**
 * An operation open past the runtime's backstop stops the turn: FAILED, with
 * the operation-limit copy naming the call and the limit, never the stall's
 * "made no progress", and the stall's stop cause. What it guards is an
 * operation with no bound of our own (a Cursor `task`): a live heartbeat over
 * it would otherwise keep a dead turn alive forever.
 */
export async function assertOpenOperationStopsAtTheBackstop(harness: RuntimeContractHarness, label = "rt-operation-limit"): Promise<RuntimeArmResult> {
  const { clock, subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label, { autoApproveAll: true });
  const id = `${label}-build`;
  const invocation = await turnWithOpenOperation(
    harness,
    driver,
    [scenario.say("Building."), scenario.open(id), scenario.say(NEVER_SEEN)],
    id,
    async () => {
      await silentFor(clock);
      clock.tick(KIT_OPEN_OPERATION_MAX_MS);
      await oneWatchdogPoll();
    },
    { openOperationMaxMs: KIT_OPEN_OPERATION_MAX_MS },
  );
  expect(slimOf(subject, invocation).phase, `${subject.name}: the backstop RETURNS FAILED`).toBe("RUN_FAILED");
  const final = finalStatusOf(harness, driver);
  const seconds = KIT_OPEN_OPERATION_MAX_MS / 1000;
  expect(final.error).toMatch(new RegExp(`^\\[OperationLimitError\\] \`[^\`]+\` ran for more than ${seconds} seconds without finishing\\. Retry or resume\\.$`));
  expect(final.stopCause, `${subject.name}: the backstop's stop cause is the stall's`).toBe("timeout");
  const notes = systemMessages(driver.record.rowsOf(final));
  expect(notes).toHaveLength(1);
  expect(notes[0]).toMatch(new RegExp(`^Execution failed: \`[^\`]+\` ran for more than ${seconds} seconds without finishing and was stopped\\. You can retry or resume\\.$`));
  expect(aiMessages(driver.record.rowsOf(final))).not.toContain(NEVER_SEEN);
  return { driver, invocations: [invocation], final };
}

/**
 * Three compactions in one turn: an engine that summarizes its context three
 * times keeps working through each and the turn completes. The person is
 * told: each compaction is one `agent.thread_context_compacted` on the root
 * thread, ahead of the closing reply, and the summary itself never reaches
 * the log as the agent's message. Where the runner makes the summary call,
 * the run's usage counts each summary, and the call asks for the runner's
 * checkpoint (`middleware/compaction-prompt.ts`): the first holds the
 * person's opening message, and each later one the summary before it with
 * the instruction to update it, so the goal is carried from summary to
 * summary.
 */
export async function assertTurnSurvivesThreeCompactions(harness: RuntimeContractHarness, gap?: string, label = "rt-three-compactions"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const controls = longTurnOf(subject);
  const driver = new RuntimeExecutionDriver(harness, label, { autoApproveAll: true });
  const invocation = await driver.turn([scenario.say("Reading everything."), scenario.compact(), scenario.compact(), scenario.compact(), scenario.say("Read it all.")]);
  await expectKnownGap(
    gapFor(gap, {
      says: "the turn does not complete through three compactions",
      holds: () => driver.record.persistedPhases.at(-1) !== RunPhase.RUN_COMPLETED,
    }),
    () => {
      expectCompleted(harness, driver, invocation, "Read it all.");
      expect(controls.compactions(driver.sessionId), `${subject.name}: the engine compacted three times`).toBe(3);
      const root = driver.record.sessionEvents.filter((e) => e.threadId === "");
      const compacted = root.flatMap((e, index) => (e.event.case === "agentThreadContextCompacted" ? [index] : []));
      expect(compacted, `${subject.name}: each compaction is one agent.thread_context_compacted on the root thread`).toHaveLength(3);
      const replies = root.flatMap((e, index) => (e.event.case === "agentMessage" ? [index] : []));
      expect(compacted.at(-1), `${subject.name}: the last compaction comes before the closing reply`).toBeLessThan(replies.at(-1) ?? -1);
      const { text, inputTokens } = controls.compactionSummary;
      const said = driver.record.sessionEvents.flatMap((e) => (e.event.case === "agentMessage" ? e.event.value.content.map((block) => block.text) : []));
      expect(said.filter((t) => t.includes(text)), `${subject.name}: the summary never speaks as the agent`).toEqual([]);
      if (inputTokens !== undefined) {
        expect(finalStatusOf(harness, driver).streamingUsage?.inputTokens, `${subject.name}: the run's usage counts the three summaries`).toBe(BigInt(3 * inputTokens));
      }
      const prompts = controls.summaryPrompts?.(driver.sessionId);
      if (prompts !== undefined) {
        expect(prompts, `${subject.name}: one summary call per compaction`).toHaveLength(3);
        expect(prompts[0], `${subject.name}: the first summary is handed the person's opening message`).toContain(RUNTIME_USER_MESSAGE);
        for (const [i, prompt] of prompts.slice(1).entries()) {
          expect(prompt, `${subject.name}: summary ${i + 2} is handed the one before it`).toContain(text);
          expect(prompt, `${subject.name}: summary ${i + 2} is told to update it`).toContain(SUMMARY_UPDATE_CLAUSE);
        }
      }
    },
  );
  return { driver, invocations: [invocation], final: finalStatusOf(harness, driver) };
}

/**
 * Let the drain's yield reach the engine before the arm moves on. A hosted
 * subject's engine runs behind the agent host's pipe, which delivers each
 * message on a microtask (`agent-host/channel.ts` `loopbackChannels`), so one
 * macrotask turn after the signal has delivered it; an in-process engine
 * saw it at once. Not a wait for the engine to act: the order of two facts
 * the arm decides (the yield is asked, then the tool is let finish).
 */
function theYieldHasCrossed(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * A drained turn yields at the next step boundary (stigmer#2428): the runner
 * drains while a tool runs, the tool is let finish, and the engine stops at
 * the boundary after it, before the text that follows, rather than cutting
 * the tool. Nothing terminal is written, the session's log says why the
 * turn moved, and the typed continuation is thrown for the workflow. The
 * next invocation completes the turn, and the tool began once across both.
 */
export async function assertDrainedTurnYieldsAtTheNextBoundary(harness: RuntimeContractHarness, label = "rt-drain-yields"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const controls = longTurnOf(subject);
  const driver = new RuntimeExecutionDriver(harness, label, { autoApproveAll: true });
  const id = `${label}-build`;
  let invocationControls: InvocationControls | undefined;
  const draining = controls.whenOpen(id).then(async () => {
    invocationControls!.signalWorkerShutdown();
    await theYieldHasCrossed();
    await controls.release(id);
  });

  const first = await driver.turn([scenario.say("Building."), scenario.open(id), scenario.say(NEVER_SEEN)], { onControls: (c) => (invocationControls = c) });
  await draining;

  expect(continuationCauseOf(first.outcome), `${subject.name}: the drained invocation throws the typed continuation, cause drain`).toBe("drain");
  const settle = expectContinuesWithoutAnEnding(harness, driver, TERMINAL_COPY.continuation.notes.drain);
  expect(aiMessages(driver.record.rowsOf(settle)), `${subject.name}: the engine stopped at the boundary after the tool`).not.toContain(NEVER_SEEN);
  expect(controls.opened(id), `${subject.name}: the running step finished, never cut`).toBe(1);

  const second = await driver.turn([scenario.open(id), scenario.say("Picked up where I left off.")]);
  expectCompleted(harness, driver, second, "Picked up where I left off.");
  expect(controls.opened(id), `${subject.name}: the step ran once across both invocations`).toBe(1);
  expect(harnessNotesOf(driver), `${subject.name}: the drain's note, once`).toEqual([TERMINAL_COPY.continuation.notes.drain]);
  expect(controls.tasksHanded(driver.sessionId, RUNTIME_USER_MESSAGE), `${subject.name}: the engine was handed the task once`).toBe(1);
  return { driver, invocations: [first, second], final: finalStatusOf(harness, driver) };
}

/**
 * A drained turn yields at its boundary even while the session's log lags
 * behind the engine: every status write takes a while once the drain is
 * asked, as a slow control plane's does, and the engine must not run past
 * the boundary meanwhile. What it did before the boundary reaches the log,
 * and nothing after it runs: the continuation asks the next round itself
 * (stigmer#2469).
 */
export async function assertDrainedTurnYieldsDespiteASlowLog(harness: RuntimeContractHarness, label = "rt-drain-slow-log"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const controls = longTurnOf(subject);
  const driver = new RuntimeExecutionDriver(harness, label, { autoApproveAll: true });
  const id = `${label}-build`;
  const recorded = driver.record.client();
  let draining = false;
  const slowWrites: Partial<StigmerClient> = {
    updateStatus: async (runId, status) => {
      if (draining) await new Promise((resolve) => setTimeout(resolve, SLOW_LOG_WRITE_MS));
      return recorded.updateStatus(runId, status);
    },
  };
  let invocationControls: InvocationControls | undefined;
  const drained = controls.whenOpen(id).then(async () => {
    draining = true;
    invocationControls!.signalWorkerShutdown();
    await theYieldHasCrossed();
    await controls.release(id);
  });

  const first = await driver.turn([scenario.say("Building."), scenario.open(id), scenario.say(NEVER_SEEN)], {
    clientOverrides: slowWrites,
    onControls: (c) => (invocationControls = c),
  });
  await drained;
  draining = false;

  expect(continuationCauseOf(first.outcome), `${subject.name}: the drained invocation continues`).toBe("drain");
  const settle = expectContinuesWithoutAnEnding(harness, driver, TERMINAL_COPY.continuation.notes.drain);
  expect(aiMessages(driver.record.rowsOf(settle)), `${subject.name}: nothing past the boundary ran`).not.toContain(NEVER_SEEN);

  const second = await driver.turn([scenario.open(id), scenario.say("Picked up where I left off.")]);
  expectCompleted(harness, driver, second, "Picked up where I left off.");
  expect(controls.opened(id), `${subject.name}: the step ran once across both invocations`).toBe(1);
  expect(controls.tasksHanded(driver.sessionId, RUNTIME_USER_MESSAGE), `${subject.name}: the engine was handed the task once`).toBe(1);
  return { driver, invocations: [first, second], final: finalStatusOf(harness, driver) };
}

/**
 * A stop while the session's log lags behind the engine: the person pauses
 * the turn during a slow status write, right after a tool's result. What the
 * engine did before the stop reaches the log, nothing after it runs, and the
 * resumed turn asks the next round itself (stigmer#2469).
 */
export async function assertStopWhileTheLogLagsRunsNothingPastIt(harness: RuntimeContractHarness, label = "rt-stop-slow-log"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const controls = longTurnOf(subject);
  const read = `${label}-read`;
  let invocationControls: InvocationControls | undefined;
  let stopped = false;
  let lagged = false;
  // The persist that carries the read's result is where the person pauses
  // (the platform-STOP arm's lever, which sees the rows); that write then
  // lags, as a slow control plane's does.
  const driver = new RuntimeExecutionDriver(harness, label, {
    autoApproveAll: true,
    controlSignal: (_status, rows) => {
      if (!stopped && findToolCallRow(rows, read)?.status === ToolCallStatus.TOOL_CALL_COMPLETED) {
        stopped = true;
        invocationControls!.cancel();
      }
      return RunControlSignal.UNSPECIFIED;
    },
  });
  const recorded = driver.record.client();
  const slowWrites: Partial<StigmerClient> = {
    updateStatus: async (runId, status) => {
      const written = await recorded.updateStatus(runId, status);
      if (stopped && !lagged) {
        lagged = true;
        await new Promise((resolve) => setTimeout(resolve, SLOW_LOG_WRITE_MS));
      }
      return written;
    },
  };

  const first = await driver.turn([scenario.say("Reading."), scenario.read(read, "package.json"), scenario.say(NEVER_SEEN)], {
    clientOverrides: slowWrites,
    onControls: (c) => (invocationControls = c),
  });

  expect(threwCancelledFailure(first.outcome), `${subject.name}: the pause throws as cancelled`).toBe(true);
  const settle = driver.record.persisted.at(-1);
  if (!settle) throw new Error(`${subject.name}: the runtime persisted nothing`);
  expect(findToolCallRow(driver.record.rowsOf(settle), read)?.status, `${subject.name}: the work before the stop is in the log`).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
  expect(aiMessages(driver.record.rowsOf(settle)), `${subject.name}: nothing past the stop ran`).not.toContain(NEVER_SEEN);

  const second = await driver.turn([scenario.read(read, "package.json"), scenario.say("Resumed.")]);
  expectCompleted(harness, driver, second, "Resumed.");
  expect(aiMessages(driver.record.rowsOf(finalStatusOf(harness, driver))), `${subject.name}: nothing past the stop ran, then or after`).not.toContain(NEVER_SEEN);
  expect(controls.tasksHanded(driver.sessionId, RUNTIME_USER_MESSAGE), `${subject.name}: the engine was handed the task once`).toBe(1);
  return { driver, invocations: [first, second], final: finalStatusOf(harness, driver) };
}

/**
 * The runner is signalled a second time while a drained turn's tool still
 * runs: the turn stops now instead of waiting for its boundary, and it
 * still continues (nothing terminal, the drain's note, the typed
 * continuation). The step it cut runs again on the next invocation, the
 * honest price of a stop nobody could wait for.
 */
export async function assertSecondSignalStopsTheDrainNow(harness: RuntimeContractHarness, label = "rt-drain-now"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const controls = longTurnOf(subject);
  const driver = new RuntimeExecutionDriver(harness, label, { autoApproveAll: true });
  const id = `${label}-build`;
  let invocationControls: InvocationControls | undefined;
  void controls.whenOpen(id).then(() => {
    invocationControls!.signalWorkerShutdown();
    invocationControls!.signalWorkerStopNow();
  });

  const first = await driver.turn([scenario.say("Building."), scenario.open(id), scenario.say(NEVER_SEEN)], { onControls: (c) => (invocationControls = c) });

  expect(continuationCauseOf(first.outcome), `${subject.name}: the stopped drain still continues, cause drain`).toBe("drain");
  const settle = expectContinuesWithoutAnEnding(harness, driver, TERMINAL_COPY.continuation.notes.drain);
  expect(aiMessages(driver.record.rowsOf(settle))).not.toContain(NEVER_SEEN);
  await controls.release(id);
  return { driver, invocations: [first], final: settle };
}

/**
 * A runner lost without a word while a tool ran (Temporal timed the
 * activity out, so the turn wrote no note): the invocation that picks the
 * turn up says so once, as the harness's note, and continues without the
 * task. The loss lands once the engine has logged its work, which is how
 * the runtime knows the turn is a continuation (`runWroteEvents`).
 */
export async function assertLostRunnerIsNotedOnce(harness: RuntimeContractHarness, label = "rt-lost-runner"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const controls = longTurnOf(subject);
  const driver = new RuntimeExecutionDriver(harness, label, { autoApproveAll: true });
  const id = `${label}-parse`;
  let invocationControls: InvocationControls | undefined;
  void controls.whenOpen(id).then(() => {
    controls.loseRunner(driver.sessionId);
    invocationControls!.cancelTimedOut();
  });
  const first = await driver.turn([scenario.say("Starting on the parser."), scenario.open(id), scenario.say(NEVER_SEEN)], { onControls: (c) => (invocationControls = c) });
  await controls.release(id);
  expect(threwCancelledFailure(first.outcome), `${subject.name}: the lost invocation throws as cancelled`).toBe(true);
  expect(harnessNotesOf(driver), `${subject.name}: the lost runner wrote nothing`).toEqual([]);

  const second = await driver.turn([scenario.open(id), scenario.say("Back on the parser.")]);
  await controls.release(id);
  expectCompleted(harness, driver, second, "Back on the parser.");
  expect(harnessNotesOf(driver), `${subject.name}: the turn that picked it up says why it paused, once`).toEqual([TERMINAL_COPY.continuation.lostRunnerNote]);
  expect(controls.tasksHanded(driver.sessionId, RUNTIME_USER_MESSAGE), `${subject.name}: the engine was handed the task once`).toBe(1);
  return { driver, invocations: [first, second], final: finalStatusOf(harness, driver) };
}

/**
 * A continuation keeps the run's cost count: a turn that spent part of its
 * budget, then drained and continued, is stopped by the cap when the two
 * invocations together reach it, though neither alone does. The cap is set
 * between the invocations, at one and a half times what the first one
 * spent, so the arm holds whatever the subject's engine prices its tokens
 * at.
 */
export async function assertContinuationCarriesTheRunsCount(harness: RuntimeContractHarness, label = "rt-continued-count"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const controls = longTurnOf(subject);
  const driver = new RuntimeExecutionDriver(harness, label, { autoApproveAll: true });
  const id = `${label}-build`;
  const usage = scenario.usage({ inputTokens: 200_000, outputTokens: 0, estimatedCostUsd: 0.2, model: "fixture-model" });
  let invocationControls: InvocationControls | undefined;
  const draining = controls.whenOpen(id).then(async () => {
    invocationControls!.signalWorkerShutdown();
    await theYieldHasCrossed();
    await controls.release(id);
  });
  const first = await driver.turn([scenario.say("Reading."), usage, scenario.open(id), scenario.say(NEVER_SEEN)], { onControls: (c) => (invocationControls = c) });
  await draining;
  expect(continuationCauseOf(first.outcome), `${subject.name}: the first invocation continues`).toBe("drain");
  const spent = driver.record.status?.streamingUsage?.estimatedCostUsd ?? 0;
  expect(spent, `${subject.name}: the first invocation spent something`).toBeGreaterThan(0);
  const runConfig = driver.record.status!.runConfig ?? create(RunConfigSchema);
  runConfig.maxCostUsd = spent * 1.5;
  driver.record.status!.runConfig = runConfig;

  const second = await driver.turn([scenario.say("Picking up."), usage, scenario.say(NEVER_SEEN)]);
  expect(slimOf(subject, second).phase, `${subject.name}: the cap stops the continuation at the run's limit`).toBe("RUN_TERMINATED");
  const final = finalStatusOf(harness, driver);
  expect(final.stopCause).toBe("budget_reached");
  expect(final.streamingUsage?.estimatedCostUsd ?? 0, `${subject.name}: the summary counts both invocations`).toBeGreaterThan(spent * 1.5);
  expect(aiMessages(driver.record.rowsOf(final))).not.toContain(NEVER_SEEN);
  return { driver, invocations: [first, second], final };
}

/**
 * A runner lost after its engine took the run's input, before anything of
 * the run reached the session's log: a process killed while its first
 * writes were still in flight. The runtime cannot tell this run from a first
 * invocation, so only the adapter's own memory of its engine can: a
 * `checkpoint` engine continues from its save, and a `digest` engine
 * continues the conversation it was sent the run in, both without the task
 * (stigmer#2417, stigmer#2487). Nothing the first invocation wrote lands, as
 * nothing a killed process wrote does.
 */
export async function assertLostBeforeTheLogKnewContinuesFromTheEngine(harness: RuntimeContractHarness, label = "rt-lost-before-log"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const controls = longTurnOf(subject);
  const driver = new RuntimeExecutionDriver(harness, label, { autoApproveAll: true });
  const id = `${label}-build`;
  const neverLands: Partial<StigmerClient> = { appendSessionEvents: async () => create(AppendSessionEventsResponseSchema) };
  let invocationControls: InvocationControls | undefined;
  void controls.whenOpen(id).then(() => {
    controls.loseRunner(driver.sessionId);
    invocationControls!.cancelTimedOut();
  });
  const first = await driver.turn([scenario.say("Building."), scenario.open(id), scenario.say(NEVER_SEEN)], {
    clientOverrides: neverLands,
    onControls: (c) => (invocationControls = c),
  });
  await controls.release(id);
  expect(threwCancelledFailure(first.outcome), `${subject.name}: the lost invocation throws as cancelled`).toBe(true);
  expect(driver.record.sessionEvents.filter((e) => e.runId === driver.record.executionId), `${subject.name}: nothing of the run reached the log`).toEqual([]);

  const second = await driver.turn([scenario.open(id), scenario.say("Picked up where I left off.")]);
  await controls.release(id);
  expectCompleted(harness, driver, second, "Picked up where I left off.");
  expect(controls.tasksHanded(driver.sessionId, RUNTIME_USER_MESSAGE), `${subject.name}: the engine was handed the task once`).toBe(1);
  return { driver, invocations: [first, second], final: finalStatusOf(harness, driver) };
}

/**
 * A continued turn whose engine had already finished (its runner was lost
 * after the engine's last step and before the turn's ending was written):
 * the engine runs nothing again, no model call, and the turn completes with
 * the answer the run already wrote. A `checkpoint` harness's fact: its saved
 * state says it finished.
 */
export async function assertFinishedEngineSettlesWithoutAModelCall(harness: RuntimeContractHarness, label = "rt-finished-engine"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const controls = longTurnOf(subject);
  const driver = new RuntimeExecutionDriver(harness, label);
  const first = await driver.turn([scenario.say("All done.")]);
  expectCompleted(harness, driver, first, "All done.");
  // The ending never landed: the server still holds the run working.
  const held = driver.record.status!;
  held.phase = RunPhase.RUN_IN_PROGRESS;
  held.completedAt = "";

  const second = await driver.turn([scenario.say(NEVER_SEEN)]);
  expect(slimOf(subject, second).phase, `${subject.name}: the continued turn completes`).toBe("RUN_COMPLETED");
  const final = finalStatusOf(harness, driver);
  expect(aiMessages(driver.record.rowsOf(final)), `${subject.name}: no model call ran`).not.toContain(NEVER_SEEN);
  expect(controls.tasksHanded(driver.sessionId, RUNTIME_USER_MESSAGE), `${subject.name}: the engine was handed the task once`).toBe(1);
  return { driver, invocations: [first, second], final };
}

/**
 * A drain after an approved call ran: the turn continues with neither the
 * task nor the decision handed again, and the approved call ran once. The
 * drain lands on the persist that carries the call's completion (the
 * platform-STOP arm's lever) rather than in an open operation: the arm keeps
 * the asking posture its approval needs, in which a native operation's
 * shell would be gated too.
 */
export async function assertDrainAfterAnApprovedCallContinues(harness: RuntimeContractHarness, label = "rt-drain-after-approval"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const controls = longTurnOf(subject);
  const approved = `${label}-shell`;
  let drainOnTheApprovedCall: (() => void) | undefined;
  const driver = new RuntimeExecutionDriver(harness, label, {
    controlSignal: (_status, rows) => {
      if (findToolCallRow(rows, approved)?.status === ToolCallStatus.TOOL_CALL_COMPLETED) drainOnTheApprovedCall?.();
      return RunControlSignal.UNSPECIFIED;
    },
  });
  const propose = scenario.propose(approved, { kind: "shell", resource: `npm run build # ${label}` });

  const first = await driver.turn([propose]);
  expect(slimOf(subject, first).phase).toBe("RUN_WAITING_FOR_APPROVAL");
  expect(driver.decide(ApprovalAction.APPROVE)).toBe(1);

  const second = await driver.turn([propose, scenario.say(NEVER_SEEN)], {
    onControls: (c) => {
      drainOnTheApprovedCall = () => {
        drainOnTheApprovedCall = undefined;
        c.signalWorkerShutdown();
      };
    },
  });
  expect(continuationCauseOf(second.outcome), `${subject.name}: the drained invocation continues`).toBe("drain");

  const third = await driver.turn([propose, scenario.say("Built.")]);
  expectCompleted(harness, driver, third, "Built.");
  expect(subject.executionCount(approved), `${subject.name}: the approved call ran once`).toBe(1);
  expect(controls.tasksHanded(driver.sessionId, RUNTIME_USER_MESSAGE), `${subject.name}: the engine was handed the task once`).toBe(1);
  return { driver, invocations: [first, second, third], final: finalStatusOf(harness, driver) };
}

/**
 * A continued turn never re-sends the task: a runner drained while a tool
 * runs, then reinvoked, picks the turn up where it was. Across both
 * invocations the engine is handed the user's message as a new request
 * once (stigmer#2417).
 */
export async function assertContinuedTurnNeverResendsTheTask(harness: RuntimeContractHarness, label = "rt-no-resent-task"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const controls = longTurnOf(subject);
  const driver = new RuntimeExecutionDriver(harness, label, { autoApproveAll: true });
  const id = `${label}-build`;
  let interrupted: InvocationControls | undefined;
  void controls.whenOpen(id).then(() => {
    interrupted!.signalWorkerShutdown();
    interrupted!.cancel();
  });
  const first = await driver.turn([scenario.say("Building."), scenario.open(id), scenario.say(NEVER_SEEN)], { onControls: (c) => (interrupted = c) });
  await controls.release(id);
  expect(threwCancelledFailure(first.outcome), `${subject.name}: the drained invocation throws the shutdown's CancelledFailure`).toBe(true);
  const second = await driver.turn([scenario.open(id), scenario.say("Picked up where I left off.")]);
  await controls.release(id);
  expect(controls.tasksHanded(driver.sessionId, RUNTIME_USER_MESSAGE), `${subject.name}: the engine was handed the task once across both invocations`).toBe(1);
  expect(harnessNotesOf(driver), `${subject.name}: the drain's note, once; the turn that picked it up adds none`).toEqual([TERMINAL_COPY.continuation.notes.drain]);
  return { driver, invocations: [first, second], final: finalStatusOf(harness, driver) };
}

// ── Messages sent while the turn works ─────────────────────────────────────

/**
 * The turn read `text` once, as a message a person sent while it worked
 * (`harness/turn-input.ts`): the engine was handed it once and the task
 * once, nothing of it waits in the session's queue, and the log holds it as
 * this run's, after the message the run started with.
 */
function expectReadOnce(harness: RuntimeContractHarness, driver: RuntimeExecutionDriver, text: string): void {
  const { subject } = harness;
  const controls = longTurnOf(subject);
  expect(controls.messagesRead(driver.sessionId, text), `${subject.name}: the engine read the message once`).toBe(1);
  expect(controls.tasksHanded(driver.sessionId, RUNTIME_USER_MESSAGE), `${subject.name}: the engine was handed the task once, never with the message`).toBe(1);
  expect(driver.record.queuedMessages, `${subject.name}: nothing waits for a next turn`).toEqual([]);
  const ownMessages = driver.record.sessionEvents
    .filter((event) => event.runId === driver.record.executionId && event.event.case === "userMessage")
    .map((event) => (event.event.case === "userMessage" ? event.event.value.content.map((block) => block.text).join("") : ""));
  expect(ownMessages, `${subject.name}: the log holds the message as this run's`).toEqual([text]);
}

/**
 * The message sits in the log where the engine read it: after the agent's
 * message `before`, which the engine wrote before it took the message, so
 * a reader of the log sees the turn in the order it happened.
 */
function expectReadAfter(harness: RuntimeContractHarness, driver: RuntimeExecutionDriver, text: string, before: string): void {
  const textOf = (event: SessionEvent): string =>
    event.event.case === "userMessage" || event.event.case === "agentMessage" ? event.event.value.content.map((block) => block.text).join("") : "";
  const own = driver.record.sessionEvents.filter((event) => event.runId === driver.record.executionId);
  const written = own.findIndex((event) => event.event.case === "agentMessage" && textOf(event).includes(before));
  const read = own.findIndex((event) => event.event.case === "userMessage" && textOf(event) === text);
  expect([written >= 0, read > written], `${harness.subject.name}: the log holds "${before}" before the message the engine read after it`).toEqual([true, true]);
}

/**
 * A message a person sends while a tool runs is read by the same turn at
 * its next step, never left for a next turn (stigmer#2429): the turn
 * completes once, having read it once.
 */
export async function assertMessageSentMidToolIsRead(harness: RuntimeContractHarness, label = "rt-message-mid-tool"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const controls = longTurnOf(subject);
  const driver = new RuntimeExecutionDriver(harness, label, { autoApproveAll: true });
  const id = `${label}-build`;
  const text = "Also update the README.";
  void controls.whenOpen(id).then(() => controls.release(id));
  const turn = await driver.turn([scenario.say("Building."), scenario.open(id), scenario.message(text), scenario.say("Built, README too.")]);
  expect(slimOf(subject, turn).phase, `${subject.name}: the turn completes`).toBe("RUN_COMPLETED");
  expectReadOnce(harness, driver, text);
  expectReadAfter(harness, driver, text, "Building.");
  return { driver, invocations: [turn], final: finalStatusOf(harness, driver) };
}

/**
 * A message a person sends as the turn writes its answer is read by that
 * turn before it completes: the round's end asks once more, whatever the
 * runtime's hint said.
 */
export async function assertMessageSentAsTheTurnAnswersIsRead(harness: RuntimeContractHarness, label = "rt-message-at-end"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const driver = new RuntimeExecutionDriver(harness, label, { autoApproveAll: true });
  const text = "And add a changelog line.";
  const turn = await driver.turn([scenario.say("Done."), scenario.message(text), scenario.say("Changelog line added.")]);
  expect(slimOf(subject, turn).phase, `${subject.name}: the turn completes`).toBe("RUN_COMPLETED");
  expectReadOnce(harness, driver, text);
  expectReadAfter(harness, driver, text, "Done.");
  return { driver, invocations: [turn], final: finalStatusOf(harness, driver) };
}

/**
 * A message sent while a tool runs, in a turn the runner drains at the
 * boundary after that tool, is read by the turn's continuation, once, and
 * the continuation is never handed the task: what a turn owes survives the
 * invocation that could not deliver it.
 */
export async function assertMessageSurvivesAContinuation(harness: RuntimeContractHarness, label = "rt-message-continued"): Promise<RuntimeArmResult> {
  const { subject } = harness;
  const controls = longTurnOf(subject);
  const driver = new RuntimeExecutionDriver(harness, label, { autoApproveAll: true });
  const id = `${label}-build`;
  const text = "Use the staging database.";
  let invocationControls: InvocationControls | undefined;
  const draining = controls.whenOpen(id).then(async () => {
    invocationControls!.signalWorkerShutdown();
    await theYieldHasCrossed();
    await controls.release(id);
  });
  const first = await driver.turn([scenario.say("Building."), scenario.open(id), scenario.message(text), scenario.say(NEVER_SEEN)], {
    onControls: (c) => (invocationControls = c),
  });
  await draining;
  expect(continuationCauseOf(first.outcome), `${subject.name}: the drained invocation throws the typed continuation, cause drain`).toBe("drain");
  const second = await driver.turn([scenario.open(id), scenario.say("Picked up, on staging.")]);
  expect(slimOf(subject, second).phase, `${subject.name}: the continuation completes`).toBe("RUN_COMPLETED");
  expectReadOnce(harness, driver, text);
  return { driver, invocations: [first, second], final: finalStatusOf(harness, driver) };
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
  /**
   * Whether this subject's engine can end its OWN run cancelled with nothing
   * to wait for (`scenario.cancelled()`, an SDK-side cancel); the arm is
   * registered SKIPPED otherwise. On by default; the native subject turns it
   * off (no LangGraph path ends a turn `cancelled` — a stop is the runtime's
   * and settles `interrupted`).
   */
  readonly engineCancel?: boolean;
  /**
   * Whether this subject's engine can hand work to a subagent
   * (`scenario.open(…, { as: "subagent" })`); the arm is registered SKIPPED
   * otherwise. On by default; the scripted fake turns it off (no subagents).
   */
  readonly subagentOperation?: boolean;
  /**
   * Whether this subject's engine can compact its context
   * (`scenario.compact()`); the arm is registered SKIPPED otherwise. On by
   * default; the scripted fake turns it off (no context).
   */
  readonly compaction?: boolean;
  /**
   * Whether this subject's engine holds a vendor connection that the vendor
   * can end mid-turn (`scenario.cut()`); the arm is registered SKIPPED
   * otherwise. On by default; the native subject turns it off.
   */
  readonly streamCut?: boolean;
  /**
   * The long-turn arms that are a known gap on this subject, each with the
   * open issue that names it (`<owner>/<repo>#<n>`). The arm passes while the
   * gap's outcome holds and fails the day it closes: the fix removes the
   * entry here.
   */
  readonly knownGaps?: Partial<Readonly<Record<LongTurnArm, string>>>;
  /**
   * The rejections this subject's engine leaves orphaned when a turn is
   * stopped in the middle of a step, which the long-turn arms do on purpose
   * while a known gap holds (the watchdog or a drain stops the turn while
   * the operation runs). A long-turn arm collects the rejections this
   * accepts for its own duration instead of letting them fail the file; any
   * other unhandled rejection still fails the arm. Absent, none is expected.
   */
  readonly stopOrphans?: (reason: unknown) => boolean;
}

/** How long, after a long-turn arm settles, a late orphan of its stopped turn may take to surface. */
const ORPHAN_SETTLE_MS = 250;

/**
 * Run one long-turn arm with the subject's declared stop orphans collected
 * (see {@link RuntimeContractOptions.stopOrphans}). The test runner's own
 * listeners are set aside for the arm and put back after, so an accepted
 * orphan never reaches them; one the subject did not declare fails the arm.
 */
async function withStopOrphans(subjectName: string, accepts: ((reason: unknown) => boolean) | undefined, arm: () => Promise<unknown>): Promise<void> {
  if (!accepts) {
    await arm();
    return;
  }
  const runnerListeners = process.listeners("unhandledRejection");
  const strays: unknown[] = [];
  const collect = (reason: unknown): void => {
    if (!accepts(reason)) strays.push(reason);
  };
  process.removeAllListeners("unhandledRejection");
  process.on("unhandledRejection", collect);
  try {
    await arm();
    await new Promise((resolve) => setTimeout(resolve, ORPHAN_SETTLE_MS));
  } finally {
    process.off("unhandledRejection", collect);
    for (const listener of runnerListeners) process.on("unhandledRejection", listener);
  }
  expect(strays.map(String), `${subjectName}: no unhandled rejection beyond the declared stop orphans`).toEqual([]);
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

    it("a completed turn: the runtime's labels, one bind, the answer on the transcript, the summed usage, the heartbeat", async () => {
      clock.reset();
      await assertCompletedTurn(harness);
    });
    it("awaiting_approval then APPROVE: the WAITING row, the reinvocation by the bound id, one execution, COMPLETED", async () => {
      clock.reset();
      await assertApprovalRoundTrip(harness);
    });
    it("a reinvocation carries the status's own outputs and seeds only its asks; a first turn carries nothing", async () => {
      clock.reset();
      await assertReinvocationCarriesThePersistedStatus(harness);
      clock.reset();
      await assertFirstTurnSeedsNothing(harness);
    });
    it("file review off: a write flows uncaptured and the turn completes", async () => {
      clock.reset();
      await assertFileReviewOffWriteFlows(harness);
    });
    it("file review: a turn the platform stops after a write leaves a change set to keep or undo", async () => {
      clock.reset();
      await assertStoppedTurnCapturesItsEdits(harness);
    });
    it("file review: two writes flow, the runtime captures and the turn completes, the person keeps one and undoes one, a reconcile turn puts it back without the engine", async () => {
      clock.reset();
      await assertFileReviewRoundTrip(harness);
    });
    for (const denyMessage of ["", "use make clean instead"]) {
      it(`awaiting_approval then a deny${denyMessage === "" ? "" : " with a reason"}: the run continues without the tool and the runtime settles the row SKIPPED`, async () => {
        clock.reset();
        await assertNonExecutingDecisionSettlesSkipped(harness, denyMessage);
      });
    }
    it("an orchestrator stop settles the transcript with no phase and no row, and throws the stop's CancelledFailure", async () => {
      clock.reset();
      await assertOrchestratorStopSettlesAndThrows(harness);
    });
    it("a worker shutdown past the grace writes no ending, notes the drain once and throws the shutdown CancelledFailure", async () => {
      clock.reset();
      await assertWorkerShutdownContinuesAndThrows(harness);
    });
    it("an infrastructure cancel writes no ending and no note, and throws the heartbeat-timeout CancelledFailure", async () => {
      clock.reset();
      await assertInfrastructureCancelContinuesAndThrows(harness);
    });
    it("a stall with nothing owed by the model fails the turn with the watchdog's idle time", async () => {
      clock.reset();
      await assertStallFailsTheTurn(harness);
    });
    it("a stall while the turn waits on its model continues, and the next invocation asks the model again without the task", async () => {
      clock.reset();
      await assertModelStallContinues(harness);
    });
    it.skipIf(options.streamCut === false)("a connection the vendor ended continues, and the next invocation picks up without the task", async () => {
      clock.reset();
      await assertStreamCutContinues(harness);
    });
    it("a cost cap terminates the turn with the budget copy; the step after the overrun is never processed", async () => {
      clock.reset();
      await assertCostCapTerminates(harness);
    });
    it("a platform STOP answered to a persist completes the turn early; the step after the STOP never runs", async () => {
      clock.reset();
      await assertPlatformStopCompletesEarly(harness);
    });
    it.skipIf(options.engineCancel === false)("an engine-cancelled run ends CANCELLED with no error and no copy", async () => {
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
    it.skipIf(subject.adapter.capabilities.stateIdSource !== "engine-minted")("a rejected bindHarnessState ends the turn failed with nothing executed", async () => {
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

    describe("long turn", () => {
      const gaps = options.knownGaps ?? {};
      const orphans = options.stopOrphans;
      it("a silent operation outlives the stall window and the turn completes", async () => {
        clock.reset();
        await withStopOrphans(subject.name, orphans, () => assertSilentOperationOutlivesTheStallWindow(harness, gaps["silent-operation"]));
      });
      it("output streams to the session while an operation runs, and the turn completes", async () => {
        clock.reset();
        await withStopOrphans(subject.name, orphans, () => assertStreamedOutputReachesTheSession(harness, gaps["streamed-output"]));
      });
      it("a working turn names its silent operation and its age at the liveness interval", async () => {
        clock.reset();
        await withStopOrphans(subject.name, orphans, () => assertLivenessNamesTheOpenOperation(harness));
      });
      it("an operation open past the backstop fails the turn with the operation-limit copy", async () => {
        clock.reset();
        await withStopOrphans(subject.name, orphans, () => assertOpenOperationStopsAtTheBackstop(harness));
      });
      it.skipIf(options.subagentOperation === false)("a subagent outlives the stall window and the parent's turn completes", async () => {
        clock.reset();
        await withStopOrphans(subject.name, orphans, () => assertSubagentOutlivesTheStallWindow(harness, gaps["subagent-operation"]));
      });
      it.skipIf(options.compaction === false)("a turn completes through three compactions", async () => {
        clock.reset();
        await withStopOrphans(subject.name, orphans, () => assertTurnSurvivesThreeCompactions(harness, gaps["three-compactions"]));
      });
      it("a drained turn yields at the step boundary after its running tool, writes no ending, and the continuation completes", async () => {
        clock.reset();
        await withStopOrphans(subject.name, orphans, () => assertDrainedTurnYieldsAtTheNextBoundary(harness));
      });
      it("a drained turn yields at its boundary while the log lags behind the engine, and the continuation asks the next round", async () => {
        clock.reset();
        await withStopOrphans(subject.name, orphans, () => assertDrainedTurnYieldsDespiteASlowLog(harness));
      });
      it("a stop while the log lags behind the engine keeps the work before it and runs nothing past it", async () => {
        clock.reset();
        await withStopOrphans(subject.name, orphans, () => assertStopWhileTheLogLagsRunsNothingPastIt(harness));
      });
      it("a second signal stops a drained turn now, and it still continues", async () => {
        clock.reset();
        await withStopOrphans(subject.name, orphans, () => assertSecondSignalStopsTheDrainNow(harness));
      });
      it("a turn continued after a drain never hands the engine the task again", async () => {
        clock.reset();
        await withStopOrphans(subject.name, orphans, () => assertContinuedTurnNeverResendsTheTask(harness));
      });
      it("a turn whose runner was lost says so once, and continues without the task", async () => {
        clock.reset();
        await withStopOrphans(subject.name, orphans, () => assertLostRunnerIsNotedOnce(harness));
      });
      it("a continued turn carries the run's cost count, so the cap stops it at the run's limit", async () => {
        clock.reset();
        await withStopOrphans(subject.name, orphans, () => assertContinuationCarriesTheRunsCount(harness));
      });
      it("a runner lost before anything of the run reached the log continues from the engine's own memory, without the task", async () => {
        clock.reset();
        await withStopOrphans(subject.name, orphans, () => assertLostBeforeTheLogKnewContinuesFromTheEngine(harness));
      });
      it.skipIf(subject.adapter.capabilities.continuation !== "checkpoint")("a continued turn whose engine had finished settles with no model call", async () => {
        clock.reset();
        await withStopOrphans(subject.name, orphans, () => assertFinishedEngineSettlesWithoutAModelCall(harness));
      });
      it("file review: a turn drained between two writes and continued is one change set with both files", async () => {
        clock.reset();
        await withStopOrphans(subject.name, orphans, () => assertContinuedTurnKeepsOneChangeSet(harness));
      });
      it("a drain after an approved call ran continues with neither the task nor the decision handed again", async () => {
        clock.reset();
        await withStopOrphans(subject.name, orphans, () => assertDrainAfterAnApprovedCallContinues(harness));
      });
    });

    describe("messages sent while the turn works", () => {
      const orphans = options.stopOrphans;
      it("a message sent while a tool runs is read by the same turn, once, and nothing waits for a next turn", async () => {
        clock.reset();
        await withStopOrphans(subject.name, orphans, () => assertMessageSentMidToolIsRead(harness));
      });
      it("a message sent as the turn answers is read before it completes", async () => {
        clock.reset();
        await withStopOrphans(subject.name, orphans, () => assertMessageSentAsTheTurnAnswersIsRead(harness));
      });
      it("a message the drained turn could not read is read once by its continuation, without the task", async () => {
        clock.reset();
        await withStopOrphans(subject.name, orphans, () => assertMessageSurvivesAContinuation(harness));
      });
    });
  });
}
