/**
 * The harness adapter contract kit — the single authoritative statement of
 * "these are THE things every `HarnessAdapter` must do," runnable against any
 * {@link HarnessContractSubject}.
 *
 * Two halves exist in the program's design; this file is the ADAPTER-SIDE
 * half: what an adapter owes the runtime through `runTurn`, `boot`,
 * `shutdown` and `releaseSession`. The runtime-side half (the throw-vs-return
 * table end to end, the whole-activity heartbeat, the single persist
 * chokepoint, the byte-pinned copy) is proven against the real runtime once
 * it exists, through the hermetic activity driver.
 *
 * The kit IS the runtime stand-in. {@link ExecutionDriver} does what the
 * runtime does around a turn: builds the `TurnInput`, threads the engine's
 * state id (empty on an engine-minted harness's first turn, then the id the
 * adapter bound; one fixed id for a deterministic harness), advances
 * `turnSeq`, hands each reinvocation a CLONE of the previous status (the
 * runtime persists and reads back; nothing survives by object identity), and
 * owns the sink. The subject owns the engine.
 *
 * ── Invariant catalog ───────────────────────────────────────────────────────
 *  1. Every exit is a `TurnOutcome`. `runTurn` resolves, never rejects, under
 *     every scenario kind and under a pre-aborted signal; a `CancelledFailure`
 *     never escapes (the runtime, not the adapter, throws it).
 *  2. A proposal is a WAITING_APPROVAL row on `sink.status` before
 *     `awaiting_approval` resolves, and never executes in that turn.
 *  3. Reinvoked with APPROVE for that id → executes exactly once; with REJECT
 *     or SKIP → never; reinvoked twice with the same decision → still once.
 *  4. Aborting `stopSignal` mid-turn settles `runTurn` as `interrupted` within
 *     {@link INTERRUPT_SETTLE_BOUND_MS}; a signal aborted BEFORE `runTurn`
 *     yields `interrupted` with nothing executed.
 *  5. Usage reaches the sink as non-negative deltas summing to what the engine
 *     emitted.
 *  6. Capability and behaviour agree on the state id: an `engine-minted`
 *     adapter binds before its first persist and resumes by the bound id, and
 *     surfaces a rejected bind as `failed` with nothing executed after it; a
 *     `deterministic` adapter never binds.
 *  7. Lifetimes: `boot` then `shutdown` resolve; `releaseSession` for a served
 *     session and for an unknown one both resolve; `shutdown` after a release
 *     resolves.
 *  8. One adapter object serves concurrent turns independently: a hanging turn
 *     and a completing turn on the same adapter never cross outcomes or
 *     execution counts.
 *
 * Every invariant is an exported plain async function first and an `it`
 * block second, so `__tests__/harness-contract-self-check.test.ts` can run
 * each one against a deliberately broken adapter and prove it fires — a kit
 * that cannot fail proves nothing. Every message names the subject.
 *
 * Above the contract line the pause primitives are indistinguishable: both
 * end a turn `awaiting_approval`, both take the decisions on reinvocation.
 * The kit therefore never branches on `capabilities.pausePrimitive`, and the
 * runner test runs the fake under both to prove it.
 */

import { describe, it, expect } from "vitest";
import { CancelledFailure } from "@temporalio/activity";
import { clone } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import type { TurnInput, TurnOutcome } from "../../harness/types.js";
import type { ProposedAction } from "../approval-contract/types.js";
import { emptyStatus } from "../proto-helpers.js";
import { RecordingTurnSink } from "./recording-sink.js";
import { scenario } from "./types.js";
import type { HarnessContractSubject, TurnScenario } from "./types.js";

/**
 * How long a turn may take to settle `interrupted` after its signal aborts.
 * Generous against a saturated CI runner (the fake settles in microtasks; a
 * real adapter cancels an SDK run), tight enough that an adapter parked on
 * anything but the signal fails here rather than at Temporal's heartbeat
 * timeout in production. A timeout race, never a sleep.
 */
export const INTERRUPT_SETTLE_BOUND_MS = 5_000;

const OUTCOME_KINDS = ["completed", "awaiting_approval", "failed", "interrupted"] as const satisfies readonly TurnOutcome["kind"][];

/** Representative gated action shared by the invariants. */
const WRITE_ALPHA: ProposedAction = { kind: "write", resource: "/work/alpha.txt" };

const NO_DECISIONS: ReadonlyMap<string, ApprovalAction> = new Map();

// ── The runtime stand-in ────────────────────────────────────────────────────

export interface TurnRun {
  readonly input: TurnInput;
  readonly sink: RecordingTurnSink;
  readonly outcome: TurnOutcome;
}

export interface TurnOptions {
  /** This invocation's decisions, keyed by tool-call id. */
  readonly decisions?: ReadonlyMap<string, ApprovalAction>;
  /** A prepared sink (e.g. one whose bind rejects); defaults to a fresh one over the threaded status. */
  readonly sink?: RecordingTurnSink;
  /** Called synchronously once `runTurn` has been entered, with the live sink — the hook that stops a turn mid-flight. */
  readonly onStarted?: (sink: RecordingTurnSink) => void;
}

/**
 * One execution's worth of turns against one subject, doing the runtime's
 * bookkeeping between them. A new driver per test: it carries the threaded
 * state id and the persisted status across reinvocations.
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
  begin(turn: TurnScenario, options: TurnOptions = {}): { readonly input: TurnInput; readonly sink: RecordingTurnSink; readonly settled: Promise<TurnOutcome> } {
    this.subject.arrange(turn);
    const sink = options.sink ?? new RecordingTurnSink({ status: this.seedStatus() });
    const input: TurnInput = {
      executionId: this.executionId,
      threadId: this.threadId,
      turnSeq: this.turnSeq,
      sessionId: this.sessionId,
      approvalDecisions: options.decisions ?? NO_DECISIONS,
    };
    const settled = this.subject.adapter.runTurn(input, sink);
    options.onStarted?.(sink);
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
async function settleWithinBound<T>(subject: HarnessContractSubject, settled: Promise<T>, when: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const bound = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${subject.name}: runTurn did not settle within ${INTERRUPT_SETTLE_BOUND_MS}ms ${when}; every adapter call must be bounded by stopSignal`)),
      INTERRUPT_SETTLE_BOUND_MS,
    );
  });
  try {
    return await Promise.race([settled, bound]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── Invariant 1 ─────────────────────────────────────────────────────────────

/**
 * Invariant 1: every exit is a `TurnOutcome`. Each scenario kind is played
 * once, the hanging one is stopped from the outside, and one turn is entered
 * with an already-aborted signal; none may reject, none may settle with an
 * unknown kind.
 */
export async function assertEveryExitIsAnOutcome(subject: HarnessContractSubject): Promise<void> {
  const driver = new ExecutionDriver(subject, "inv1");
  const plays: ReadonlyArray<{ readonly when: string; readonly turn: TurnScenario; readonly options?: TurnOptions }> = [
    { when: "on a plain text turn", turn: [scenario.say("hello")] },
    { when: "on a usage-only turn", turn: [scenario.usage({ inputTokens: 1, outputTokens: 1 })] },
    { when: "on an undecided proposal", turn: [scenario.propose("inv1-call", WRITE_ALPHA)] },
    { when: "on an engine failure", turn: [scenario.fail("engine exploded")] },
    {
      when: "on a hang stopped from the outside",
      turn: [scenario.hang()],
      options: { onStarted: (sink) => setImmediate(() => sink.abort("kit: stop")) },
    },
  ];
  for (const play of plays) {
    const { sink, settled } = driver.begin(play.turn, play.options);
    await settleAsOutcome(subject, settleWithinBound(subject, settled, play.when), play.when);
    driver.recordTurn(sink);
  }

  const preAborted = new RecordingTurnSink({ status: driver.seedStatus() });
  preAborted.abort("kit: aborted before the turn");
  const { settled } = driver.begin([scenario.say("never")], { sink: preAborted });
  await settleAsOutcome(subject, settleWithinBound(subject, settled, "under a pre-aborted signal"), "under a pre-aborted signal");
}

// ── The runnable suite ──────────────────────────────────────────────────────

/** Register the adapter-side contract against one subject. */
export function describeHarnessContract(subject: HarnessContractSubject): void {
  describe(`harness contract — ${subject.name}`, () => {
    it("settles every turn with a TurnOutcome and never rejects (invariant 1)", async () => {
      await assertEveryExitIsAnOutcome(subject);
    });
  });
}
