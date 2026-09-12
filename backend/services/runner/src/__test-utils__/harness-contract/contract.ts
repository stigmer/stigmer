/**
 * The harness adapter contract kit — the single authoritative statement of
 * "these are THE things every `HarnessAdapter` must do," runnable against any
 * {@link HarnessContractSubject}.
 *
 * Two halves exist in the program's design; this file is the ADAPTER-SIDE
 * half: what an adapter owes the runtime through `runTurn`, `boot`,
 * `shutdown` and `releaseSession`. The runtime-side half (the throw-vs-return
 * table end to end, the whole-activity heartbeat, the single persist
 * chokepoint, the byte-pinned copy) is `runtime-contract.ts`, proven against
 * the real runtime under `MockActivityEnvironment` with the same subjects.
 *
 * The kit IS the runtime stand-in. {@link ExecutionDriver} does what the
 * runtime and the server do around a turn: builds the `TurnInput`, threads
 * the engine's state id (empty on an engine-minted harness's first turn, then
 * the id the adapter bound; one fixed id for a deterministic harness),
 * advances `turnSeq`, records a user's decision the way `SubmitApproval` does
 * (on the persisted row's `approvalAction`, the one copy) and derives the
 * decisions map from those rows on the next invocation with the runtime's
 * own reader, hands each reinvocation a CLONE of the previous status on BOTH
 * the sink and the record (`execution.status` — the runtime seeds the one
 * from the other, and an adapter may read the record's copy for its facts;
 * nothing survives by object identity), and owns the sink. The subject owns
 * the engine, and tells the kit when that engine is parked on a hang, which
 * is the only moment the kit stops a turn from the outside: a real engine
 * reaches its hang after real setup, and a stop delivered earlier lands in
 * the setup and proves nothing. The kit also owns the adapter's lifetime —
 * booted before the first turn, shut down after the last — because the
 * registry does, and a real adapter refuses a turn before boot.
 *
 * ── Invariant catalog ───────────────────────────────────────────────────────
 *  1. Every exit is a `TurnOutcome`. `runTurn` resolves, never rejects, under
 *     every scenario kind and under a pre-aborted signal; a `CancelledFailure`
 *     never escapes (the runtime, not the adapter, throws it).
 *  2. A proposal is a WAITING_APPROVAL row on `sink.status` when
 *     `awaiting_approval` resolves, and never executes in that turn.
 *  3. Reinvoked with APPROVE for that id → executes exactly once and the row
 *     is carried to COMPLETED; with REJECT or SKIP → never executes and the
 *     turn continues (the row's terminal status is the runtime's to write,
 *     not the adapter's — Q-M4-1); reinvoked again after the approval → still
 *     once, never re-gated.
 *  4. Aborting `stopSignal` mid-hang settles `runTurn` as `interrupted` within
 *     {@link INTERRUPT_SETTLE_BOUND_MS} and nothing after the stop executes; a
 *     signal aborted BEFORE `runTurn` yields `interrupted` with nothing done.
 *  5. Usage reaches the sink as non-negative deltas summing to what the engine
 *     emitted.
 *  6. Capability and behaviour agree on the state id: an `engine-minted`
 *     adapter binds before its first persist and resumes by the bound id, and
 *     surfaces a rejected bind as `failed` with nothing done after it; a
 *     `deterministic` adapter never binds.
 *  7. Lifetimes: `releaseSession` for a served session and for an unknown one
 *     both resolve; `shutdown` after a release resolves; `boot` after
 *     `shutdown` resolves (a worker restart re-boots the same module state).
 *  8. One adapter object serves concurrent turns independently: a hanging turn
 *     and a completing turn on the same adapter never cross outcomes or
 *     execution counts.
 *
 * Every invariant is an exported plain async function first and an `it`
 * block second, so `__tests__/harness-contract-self-check.test.ts` can run
 * each one against a deliberately broken adapter and prove it fires — a kit
 * that cannot fail proves nothing. Every message names the subject. Each
 * function requires a booted adapter; {@link describeHarnessContract} boots.
 *
 * Above the contract line the pause primitives are indistinguishable: both
 * end a turn `awaiting_approval`, both take the decisions on reinvocation.
 * The kit therefore never branches on `capabilities.pausePrimitive`, and the
 * runner test runs the fake under both to prove it.
 */

import { afterAll, beforeAll, describe, it, expect } from "vitest";
import { CancelledFailure } from "@temporalio/activity";
import { clone } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApprovalAction, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { approvalDecisionsOf } from "../../harness/turn-context.js";
import type { TurnInput, TurnOutcome, UsageDelta } from "../../harness/types.js";
import type { ProposedAction } from "../approval-contract/types.js";
import { emptyStatus, findToolCallRow } from "../proto-helpers.js";
import { turnInputFixture } from "../turn-input-fixture.js";
import { RecordingTurnSink } from "./recording-sink.js";
import { scenario } from "./types.js";
import type { EngineView, HarnessContractSubject, TurnScenario } from "./types.js";

/**
 * How long a turn may take to settle `interrupted` after its signal aborts.
 * Generous against a saturated CI runner (the fake settles in microtasks; a
 * real adapter cancels an SDK run), tight enough that an adapter parked on
 * anything but the signal fails here rather than at Temporal's heartbeat
 * timeout in production. A timeout race, never a sleep.
 */
export const INTERRUPT_SETTLE_BOUND_MS = 5_000;

const OUTCOME_KINDS = ["completed", "cancelled", "awaiting_approval", "failed", "interrupted"] as const satisfies readonly TurnOutcome["kind"][];

/** Representative gated action shared by the invariants. */
const WRITE_ALPHA: ProposedAction = { kind: "write", resource: "/work/alpha.txt" };

// ── The runtime (and server) stand-in ───────────────────────────────────────

export interface TurnRun {
  readonly input: TurnInput;
  readonly sink: RecordingTurnSink;
  readonly outcome: TurnOutcome;
}

export interface TurnOptions {
  /** A prepared sink (e.g. one whose bind rejects); defaults to a fresh one over the threaded status. */
  readonly sink?: RecordingTurnSink;
  /**
   * Abort the sink's signal with this reason the moment the engine reports
   * it is parked on a `hang` — the one way the kit stops a turn from the
   * outside (see the header on why not sooner).
   */
  readonly stopWhenHanging?: string;
}

export interface TurnInFlight {
  readonly input: TurnInput;
  readonly sink: RecordingTurnSink;
  readonly settled: Promise<TurnOutcome>;
}

/**
 * One execution's worth of turns against one subject, doing the runtime's
 * and the server's bookkeeping between them. A new driver per test: it
 * carries the threaded state id and the persisted status across
 * reinvocations.
 */
export class ExecutionDriver {
  readonly executionId: string;
  readonly sessionId: string;
  private threadId: string;
  private turnSeq = 0;
  private persisted: AgentExecutionStatus | undefined;

  constructor(private readonly subject: HarnessContractSubject, label: string) {
    this.executionId = `exec-${label}`;
    this.sessionId = `ses-${label}`;
    // A deterministic harness's id is the runtime's, known before any engine
    // exists (native's `thread-{sessionId}`); an engine-minted one has nothing
    // until the adapter binds.
    this.threadId = subject.adapter.capabilities.stateIdSource === "deterministic" ? `thread-${this.sessionId}` : "";
  }

  /** Start a turn without awaiting it, for invariants about turns in flight. */
  begin(turn: TurnScenario, options: TurnOptions = {}): TurnInFlight {
    const sink = options.sink ?? new RecordingTurnSink({ status: this.seedStatus() });
    // The engine's view and the record's copy both derive from the status
    // this turn folds into, so a prepared sink's status is honoured too.
    const view: EngineView = {
      executionId: this.executionId,
      sessionId: this.sessionId,
      approvalDecisions: approvalDecisionsOf(sink.status),
    };
    this.subject.arrange(turn, view);
    // Registered BEFORE the turn is entered so a hang reached synchronously
    // is still observed; the abort itself lands when the engine reports.
    const parked = options.stopWhenHanging !== undefined ? this.subject.whenHanging() : undefined;
    // The whole resolved record: the subject's needs under the driver's five
    // facts and the persisted status (`turn-input-fixture.ts`).
    const input: TurnInput = turnInputFixture({
      ...this.subject.inputOverrides?.(view),
      executionId: this.executionId,
      threadId: this.threadId,
      turnSeq: this.turnSeq,
      sessionId: this.sessionId,
      approvalDecisions: view.approvalDecisions,
      persistedStatus: clone(AgentExecutionStatusSchema, sink.status),
    });
    const settled = this.subject.adapter.runTurn(input, sink);
    if (parked && options.stopWhenHanging !== undefined) {
      const reason = options.stopWhenHanging;
      void parked.then(() => sink.abort(reason));
    }
    return { input, sink, settled };
  }

  /** Run a turn to its outcome and do the runtime's bookkeeping after it. */
  async turn(turn: TurnScenario, options: TurnOptions = {}): Promise<TurnRun> {
    const { input, sink, settled } = this.begin(turn, options);
    const outcome = await settled;
    this.recordTurn(sink);
    return { input, sink, outcome };
  }

  /** The runtime's post-turn bookkeeping: persist the status, adopt a bound id, advance the cycle. */
  recordTurn(sink: RecordingTurnSink): void {
    this.persisted = sink.status;
    const bound = sink.boundStateIds.at(-1);
    if (bound !== undefined) this.threadId = bound;
    this.turnSeq += 1;
  }

  /**
   * The server's act between invocations: `SubmitApproval` writes the user's
   * verdict onto the WAITING row it owns. A decision on a row that does not
   * exist or is not waiting is a test bug, not a contract case.
   */
  decide(toolCallId: string, action: ApprovalAction): void {
    const row = this.persisted ? findToolCallRow(this.persisted, toolCallId) : undefined;
    if (!row || row.status !== ToolCallStatus.TOOL_CALL_WAITING_APPROVAL) {
      const rows = (this.persisted?.messages ?? [])
        .flatMap((m) => m.toolCalls)
        .map((tc) => `${tc.id}=${ToolCallStatus[tc.status]}`)
        .join(", ");
      throw new Error(`${this.subject.name}: kit bug — decide('${toolCallId}') but no WAITING row was persisted (rows: ${rows || "none"})`);
    }
    row.approvalAction = action;
  }

  /** The status a reinvocation is seeded with: a clone of what was persisted. */
  seedStatus(): AgentExecutionStatus {
    return this.persisted ? clone(AgentExecutionStatusSchema, this.persisted) : emptyStatus();
  }
}

// ── Shared assertion helpers ────────────────────────────────────────────────

/**
 * Await a turn, translating a rejection into a contract violation that names
 * the subject and the kind of throw. A `CancelledFailure` gets named
 * specially because throwing it is the one thing an adapter is most tempted
 * to do and must never do.
 */
async function settleAsOutcome(subject: HarnessContractSubject, settled: Promise<TurnOutcome>, when: string): Promise<TurnOutcome> {
  let outcome: TurnOutcome;
  try {
    outcome = await settled;
  } catch (err) {
    const kind = err instanceof CancelledFailure ? "a CancelledFailure" : `an exception (${err instanceof Error ? err.message : String(err)})`;
    throw new Error(`${subject.name}: runTurn rejected with ${kind} ${when}; every exit must be a TurnOutcome`);
  }
  expect(OUTCOME_KINDS, `${subject.name}: runTurn settled with an unknown outcome kind ${when}`).toContain(outcome.kind);
  return outcome;
}

/** Race a settlement against the interrupt bound; the timer is cleared on settle so a passing test holds nothing. */
async function settleWithinBound<T>(subject: HarnessContractSubject, settled: Promise<T>, when: string, boundMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const bound = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${subject.name}: runTurn did not settle within ${boundMs}ms ${when}; every adapter call must be bounded by stopSignal`)),
      boundMs,
    );
  });
  try {
    return await Promise.race([settled, bound]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function expectResolves(subject: HarnessContractSubject, call: Promise<void>, what: string): Promise<void> {
  try {
    await call;
  } catch (err) {
    throw new Error(`${subject.name}: ${what} rejected (${err instanceof Error ? err.message : String(err)}); it must resolve`);
  }
}

// ── Invariant 1 ─────────────────────────────────────────────────────────────

/**
 * Invariant 1: every exit is a `TurnOutcome`. Each scenario kind is played
 * once, the hanging one is stopped from the outside, and one turn is entered
 * with an already-aborted signal; none may reject, none may settle with an
 * unknown kind.
 */
export async function assertEveryExitIsAnOutcome(subject: HarnessContractSubject, boundMs = INTERRUPT_SETTLE_BOUND_MS): Promise<void> {
  const driver = new ExecutionDriver(subject, "inv1");
  const plays: ReadonlyArray<{ readonly when: string; readonly turn: TurnScenario; readonly options?: TurnOptions }> = [
    { when: "on a plain text turn", turn: [scenario.say("hello")] },
    { when: "on a usage-only turn", turn: [scenario.usage({ inputTokens: 1, outputTokens: 1 })] },
    { when: "on an undecided proposal", turn: [scenario.propose("inv1-call", WRITE_ALPHA)] },
    { when: "on an engine failure", turn: [scenario.fail("engine exploded")] },
    { when: "on a hang stopped from the outside", turn: [scenario.hang()], options: { stopWhenHanging: "kit: stop" } },
  ];
  for (const play of plays) {
    const { sink, settled } = driver.begin(play.turn, play.options);
    await settleAsOutcome(subject, settleWithinBound(subject, settled, play.when, boundMs), play.when);
    driver.recordTurn(sink);
  }

  const preAborted = new RecordingTurnSink({ status: driver.seedStatus() });
  preAborted.abort("kit: aborted before the turn");
  const { settled } = driver.begin([scenario.say("never")], { sink: preAborted });
  await settleAsOutcome(subject, settleWithinBound(subject, settled, "under a pre-aborted signal", boundMs), "under a pre-aborted signal");
}

// ── Invariant 2 ─────────────────────────────────────────────────────────────

/**
 * Invariant 2: a proposal is a WAITING_APPROVAL row and never executes in its
 * own turn. The row must carry `requiresApproval` and an UNSPECIFIED
 * `approvalAction` (the server's field, untouched by the adapter), and the
 * turn must end `awaiting_approval` — not `completed`, which would tell the
 * workflow nothing is pending.
 */
export async function assertProposalIsWaitingAndUnexecuted(subject: HarnessContractSubject): Promise<void> {
  const driver = new ExecutionDriver(subject, "inv2");
  const id = "inv2-write";
  const { outcome, sink } = await driver.turn([scenario.say("about to write"), scenario.propose(id, WRITE_ALPHA), scenario.say("after")]);

  expect(outcome.kind, `${subject.name}: a turn that proposes an undecided action must end awaiting_approval`).toBe("awaiting_approval");
  const row = findToolCallRow(sink.status, id);
  expect(row, `${subject.name}: the proposal must be a tool-call row on sink.status when awaiting_approval resolves`).toBeDefined();
  expect(row?.status, `${subject.name}: the proposal's row must be WAITING_APPROVAL`).toBe(ToolCallStatus.TOOL_CALL_WAITING_APPROVAL);
  expect(row?.requiresApproval, `${subject.name}: the proposal's row must carry requiresApproval`).toBe(true);
  expect(row?.approvalAction, `${subject.name}: the adapter must never write the server's approvalAction`).toBe(ApprovalAction.UNSPECIFIED);
  expect(subject.executionCount(id), `${subject.name}: an undecided proposal must not execute in its own turn`).toBe(0);
}

// ── Invariant 3 ─────────────────────────────────────────────────────────────

/**
 * Invariant 3: the decision is honoured exactly. APPROVE executes once and
 * only once, however many times the same decided row is seen again, and the
 * engine's completion reaches the row; REJECT and SKIP never execute and the
 * turn continues — the row's terminal status is NOT asserted here because
 * it is not the adapter's to write (the decision is the server's field and
 * the WAITING → SKIPPED transition follows from it with no engine knowledge,
 * so it is the runtime's; S2 M4 Q-M4-1, the runtime's arm lands in S3). The
 * reinvocation sees a CLONE of the persisted status, as it would from the
 * server.
 */
export async function assertDecisionsExecuteExactlyOnce(subject: HarnessContractSubject): Promise<void> {
  const driver = new ExecutionDriver(subject, "inv3");

  const approved = "inv3-approve";
  const first = await driver.turn([scenario.propose(approved, WRITE_ALPHA)]);
  expect(first.outcome.kind, `${subject.name}: proposal must end awaiting_approval`).toBe("awaiting_approval");
  driver.decide(approved, ApprovalAction.APPROVE);

  const resumed = await driver.turn([scenario.propose(approved, WRITE_ALPHA), scenario.say("done")]);
  expect(resumed.outcome.kind, `${subject.name}: after APPROVE the turn must run to completion`).toBe("completed");
  expect(subject.executionCount(approved), `${subject.name}: an approved action must execute exactly once`).toBe(1);
  expect(findToolCallRow(resumed.sink.status, approved)?.status, `${subject.name}: the approved row must be carried to COMPLETED`).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);

  const again = await driver.turn([scenario.propose(approved, WRITE_ALPHA), scenario.say("again")]);
  expect(again.outcome.kind, `${subject.name}: a settled proposal seen again must not re-gate`).toBe("completed");
  expect(subject.executionCount(approved), `${subject.name}: reinvoked again after the approval, the action must still have executed exactly once`).toBe(1);

  for (const [label, action] of [["REJECT", ApprovalAction.REJECT], ["SKIP", ApprovalAction.SKIP]] as const) {
    const id = `inv3-${label.toLowerCase()}`;
    const proposed = await driver.turn([scenario.propose(id, WRITE_ALPHA)]);
    expect(proposed.outcome.kind, `${subject.name}: proposal must end awaiting_approval`).toBe("awaiting_approval");
    driver.decide(id, action);
    const decided = await driver.turn([scenario.propose(id, WRITE_ALPHA), scenario.say("moving on")]);
    expect(decided.outcome.kind, `${subject.name}: after ${label} the turn must continue to completion`).toBe("completed");
    expect(subject.executionCount(id), `${subject.name}: a ${label}-ed action must never execute`).toBe(0);
    expect(findToolCallRow(decided.sink.status, id)?.status, `${subject.name}: a ${label}-ed action must never be reported as executed`).not.toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
  }
}

// ── Invariant 4 ─────────────────────────────────────────────────────────────

/**
 * Invariant 4: the stop signal is honoured promptly and completely. A turn
 * stopped WHILE HANGING (the engine has reported it is parked, so the stop
 * lands in the hang and not in the adapter's setup) settles `interrupted`
 * within the bound and executes nothing that came after the hang, even an
 * already-approved action; a turn entered under an aborted signal does
 * nothing at all.
 */
export async function assertStopSignalInterrupts(subject: HarnessContractSubject, boundMs = INTERRUPT_SETTLE_BOUND_MS): Promise<void> {
  const driver = new ExecutionDriver(subject, "inv4");
  const id = "inv4-approved-after-hang";

  const proposed = await driver.turn([scenario.propose(id, WRITE_ALPHA)]);
  expect(proposed.outcome.kind, `${subject.name}: proposal must end awaiting_approval`).toBe("awaiting_approval");
  driver.decide(id, ApprovalAction.APPROVE);

  const hanging = driver.begin([scenario.say("working"), scenario.hang(), scenario.propose(id, WRITE_ALPHA)], { stopWhenHanging: "kit: user pause" });
  const outcome = await settleWithinBound(subject, hanging.settled, "after stopSignal aborted mid-hang", boundMs);
  expect(outcome.kind, `${subject.name}: a turn stopped mid-hang must settle interrupted`).toBe("interrupted");
  expect(subject.executionCount(id), `${subject.name}: nothing after the stop may execute, even an approved action`).toBe(0);
  driver.recordTurn(hanging.sink);

  const preAborted = new RecordingTurnSink({ status: driver.seedStatus() });
  preAborted.abort("kit: aborted before the turn");
  const early = driver.begin([scenario.propose(id, WRITE_ALPHA)], { sink: preAborted });
  const earlyOutcome = await settleWithinBound(subject, early.settled, "under a pre-aborted signal", boundMs);
  expect(earlyOutcome.kind, `${subject.name}: a turn entered under an aborted signal must settle interrupted`).toBe("interrupted");
  expect(subject.executionCount(id), `${subject.name}: a turn entered under an aborted signal must do no work`).toBe(0);
  expect(preAborted.persistRequests, `${subject.name}: a turn entered under an aborted signal must not ask to persist`).toBe(0);
}

// ── Invariant 5 ─────────────────────────────────────────────────────────────

/** The four counts summed; the price and its basis are the adapter's per delta and are not summed here. */
interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

const TOKEN_COUNT_FIELDS = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"] as const satisfies readonly (keyof UsageTotals)[];

function sumUsage(deltas: readonly UsageDelta[]): UsageTotals {
  const total: UsageTotals = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  for (const d of deltas) {
    for (const field of TOKEN_COUNT_FIELDS) total[field] += d[field] ?? 0;
  }
  return total;
}

/**
 * Invariant 5: usage reaches the sink as deltas — the token counts and the
 * price non-negative, and the counts summing to what the engine emitted. An
 * adapter that reports cumulative totals instead of deltas would
 * double-count in the runtime's accumulator and trip the cost cap early; one
 * that reports a negative number would credit it. The basis a delta names
 * (`model`, `requestedModelParams`) is the adapter's own and not judged here.
 */
export async function assertUsageReachesSinkAsDeltas(subject: HarnessContractSubject): Promise<void> {
  const driver = new ExecutionDriver(subject, "inv5");
  const emitted: readonly UsageDelta[] = [
    { inputTokens: 10, outputTokens: 5 },
    { inputTokens: 3, cacheReadTokens: 2 },
    { outputTokens: 4, cacheWriteTokens: 1 },
  ];
  const { outcome, sink } = await driver.turn([...emitted.map((d) => scenario.usage(d)), scenario.say("done")]);
  expect(outcome.kind, `${subject.name}: a usage-reporting turn must complete`).toBe("completed");

  for (const delta of sink.usageDeltas) {
    for (const field of [...TOKEN_COUNT_FIELDS, "estimatedCostUsd"] as const) {
      const value = delta[field];
      if (value === undefined) continue;
      expect(value, `${subject.name}: usage delta field ${field} must be non-negative`).toBeGreaterThanOrEqual(0);
    }
  }
  expect(sumUsage(sink.usageDeltas), `${subject.name}: the usage deltas must sum to what the engine emitted`).toEqual(sumUsage(emitted));
}

// ── Invariant 6 ─────────────────────────────────────────────────────────────

/**
 * Invariant 6: capability and behaviour agree on the state id. Engine-minted:
 * the bind precedes the first persist (so a crash mid-turn still resumes),
 * the id threaded back on the next invocation is accepted, and a rejected
 * bind ends the turn `failed` with nothing done after it. Deterministic: the
 * adapter never binds and accepts the runtime's id on every turn.
 */
export async function assertStateIdCapabilityAgrees(subject: HarnessContractSubject): Promise<void> {
  const driver = new ExecutionDriver(subject, "inv6");
  const first = await driver.turn([scenario.say("first turn")]);
  expect(first.outcome.kind, `${subject.name}: a plain turn must complete`).toBe("completed");

  if (subject.adapter.capabilities.stateIdSource === "engine-minted") {
    expect(first.input.threadId, `${subject.name}: an engine-minted harness has no state id before its first turn`).toBe("");
    const events = first.sink.events;
    const firstBind = events.findIndex((e) => e.kind === "bind");
    const firstPersist = events.findIndex((e) => e.kind === "persist");
    expect(firstBind, `${subject.name}: an engine-minted adapter must bind its state id on the first turn`).toBeGreaterThanOrEqual(0);
    expect(first.sink.boundStateIds[0], `${subject.name}: the bound state id must be non-empty`).toBeTruthy();
    if (firstPersist >= 0) {
      expect(firstBind, `${subject.name}: the state id must be bound BEFORE the first persist request, or a crash mid-turn cannot resume`).toBeLessThan(firstPersist);
    }

    const second = await driver.turn([scenario.say("second turn")]);
    expect(second.input.threadId, `${subject.name}: the kit threads the bound id back as threadId`).toBe(first.sink.boundStateIds[0]);
    expect(second.outcome.kind, `${subject.name}: resuming by the id the adapter bound must complete`).toBe("completed");
    expect(second.sink.boundStateIds, `${subject.name}: a resumed turn must not bind a new state id`).toHaveLength(0);

    const failing = new ExecutionDriver(subject, "inv6-bind-rejects");
    const rejecting = new RecordingTurnSink({ bindRejectsWith: new Error("session write failed") });
    const rejected = await failing.turn([scenario.say("never persisted")], { sink: rejecting });
    expect(rejected.outcome.kind, `${subject.name}: a rejected bind must end the turn failed, not reject runTurn`).toBe("failed");
    expect(rejecting.persistRequests, `${subject.name}: nothing may be persisted after a rejected bind`).toBe(0);
    expect(rejecting.status.messages, `${subject.name}: nothing may be folded into the status after a rejected bind`).toHaveLength(0);
  } else {
    expect(first.input.threadId, `${subject.name}: a deterministic harness is handed the runtime's id on its first turn`).not.toBe("");
    expect(first.sink.boundStateIds, `${subject.name}: a deterministic adapter must never bind a state id`).toHaveLength(0);
    const second = await driver.turn([scenario.say("second turn")]);
    expect(second.input.threadId, `${subject.name}: a deterministic id is the same on every turn`).toBe(first.input.threadId);
    expect(second.outcome.kind, `${subject.name}: a deterministic resume must complete`).toBe("completed");
    expect(second.sink.boundStateIds, `${subject.name}: a deterministic adapter must never bind a state id`).toHaveLength(0);
  }
}

// ── Invariant 7 ─────────────────────────────────────────────────────────────

/**
 * Invariant 7: the lifetimes resolve. On the booted adapter: serve a turn,
 * release the served session and an unknown one, shut down, and boot again
 * (a worker restart re-boots the same module state). Each must resolve — a
 * rejection in any would leak a session's resources, hang a drain, or fail
 * the next worker's boot. Boot itself is proven by every turn before this
 * one having run.
 */
export async function assertLifetimesResolve(subject: HarnessContractSubject): Promise<void> {
  const { adapter } = subject;
  const driver = new ExecutionDriver(subject, "inv7");
  const served = await driver.turn([scenario.say("served")]);
  expect(served.outcome.kind, `${subject.name}: a plain turn must complete`).toBe("completed");

  await expectResolves(subject, adapter.releaseSession(served.input.sessionId), `releaseSession('${served.input.sessionId}') for a served session`);
  await expectResolves(subject, adapter.releaseSession("ses-never-served"), "releaseSession for an unknown session");
  await expectResolves(subject, adapter.shutdown(), "shutdown() after release");
  await expectResolves(subject, adapter.boot(subject.config), "boot(config) after shutdown (a worker restart)");
}

// ── Invariant 8 ─────────────────────────────────────────────────────────────

/**
 * Invariant 8: one adapter object, many turns. While one execution's turn
 * hangs (reported parked before the other execution starts, so the two are
 * truly concurrent and not merely queued), another execution's turns
 * propose, get decided and execute on the SAME adapter; stopping the hanging
 * turn settles only it; nothing crosses. This is "the adapter holds no
 * per-turn state" made observable — the property `maxConcurrentActivities`
 * relies on.
 */
export async function assertConcurrentTurnsAreIndependent(subject: HarnessContractSubject, boundMs = INTERRUPT_SETTLE_BOUND_MS): Promise<void> {
  const hangingExecution = new ExecutionDriver(subject, "inv8-hanging");
  const busyExecution = new ExecutionDriver(subject, "inv8-busy");
  const id = "inv8-busy-write";

  const parked = subject.whenHanging();
  const hanging = hangingExecution.begin([scenario.say("parked"), scenario.hang()]);
  await settleWithinBound(subject, parked, "waiting for the first execution to park on its hang", boundMs);

  const proposed = await settleWithinBound(subject, busyExecution.turn([scenario.propose(id, WRITE_ALPHA)]), "on a second execution while another turn hangs", boundMs);
  expect(proposed.outcome.kind, `${subject.name}: a second execution's proposal must settle while another turn hangs`).toBe("awaiting_approval");
  busyExecution.decide(id, ApprovalAction.APPROVE);
  const resumed = await settleWithinBound(subject, busyExecution.turn([scenario.propose(id, WRITE_ALPHA)]), "on a second execution's reinvocation while another turn hangs", boundMs);
  expect(resumed.outcome.kind, `${subject.name}: a second execution's approved turn must complete while another turn hangs`).toBe("completed");
  expect(subject.executionCount(id), `${subject.name}: the busy execution's action must execute exactly once`).toBe(1);

  hanging.sink.abort("kit: stop the parked turn");
  const stopped = await settleWithinBound(subject, hanging.settled, "after the hanging turn was stopped", boundMs);
  expect(stopped.kind, `${subject.name}: the hanging turn must settle interrupted, and only it`).toBe("interrupted");
  expect(subject.executionCount(id), `${subject.name}: stopping one execution must not touch another's execution count`).toBe(1);
  expect(findToolCallRow(hanging.sink.status, id), `${subject.name}: one execution's rows must never appear on another's status`).toBeUndefined();
}

// ── The runnable suite ──────────────────────────────────────────────────────

/**
 * Register the adapter-side contract against one subject. Boots the adapter
 * once before the first invariant and shuts it down after the last, as the
 * registry does around a worker's life (`bootHarnesses` / `shutdownHarnesses`).
 */
export function describeHarnessContract(subject: HarnessContractSubject): void {
  describe(`harness contract — ${subject.name}`, () => {
    beforeAll(async () => {
      await subject.adapter.boot(subject.config);
    });
    afterAll(async () => {
      await subject.adapter.shutdown();
    });

    it("settles every turn with a TurnOutcome and never rejects (invariant 1)", async () => {
      await assertEveryExitIsAnOutcome(subject);
    });
    it("surfaces a proposal as a WAITING row and never executes it in its turn (invariant 2)", async () => {
      await assertProposalIsWaitingAndUnexecuted(subject);
    });
    it("executes an approval exactly once and a rejection or skip never (invariant 3)", async () => {
      await assertDecisionsExecuteExactlyOnce(subject);
    });
    it("settles interrupted promptly when stopSignal aborts and does nothing after it (invariant 4)", async () => {
      await assertStopSignalInterrupts(subject);
    });
    it("reports usage as non-negative deltas that sum to what the engine emitted (invariant 5)", async () => {
      await assertUsageReachesSinkAsDeltas(subject);
    });
    it(`binds its state id as its ${subject.adapter.capabilities.stateIdSource} capability declares (invariant 6)`, async () => {
      await assertStateIdCapabilityAgrees(subject);
    });
    it("serves, releases, shuts down and re-boots without a rejection (invariant 7)", async () => {
      await assertLifetimesResolve(subject);
    });
    it("serves concurrent turns on one adapter object independently (invariant 8)", async () => {
      await assertConcurrentTurnsAreIndependent(subject);
    });
  });
}
