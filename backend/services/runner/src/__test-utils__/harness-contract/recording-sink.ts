/**
 * A `TurnSink` that records everything an adapter asks of the runtime.
 *
 * The kit is the runtime stand-in, and this is the runtime's face during one
 * turn: it owns the `AbortController` behind `stopSignal` (so a test can stop
 * the turn from the outside, exactly as the runtime's watchdog, accounting or
 * heartbeat would) and the one behind `yieldSignal` (so a test can drain the
 * runner as the runtime would), and it keeps ONE ordered log of every call the adapter
 * made. Counts and lists are derived from the log on read rather than kept
 * as parallel counters, because the invariants care about ORDER as much as
 * about counts ("bind before the first persist" is an ordering claim).
 *
 * `bindHarnessState` can be made to reject, standing in for a failed session
 * write, so the kit can prove an adapter surfaces a runtime-side failure as
 * `failed` instead of letting it escape `runTurn`.
 *
 * One sink per turn, like the runtime. A reinvocation gets a NEW sink whose
 * rows are seeded with the asks the driver's log holds, as the runtime seeds
 * them (`harness/transcript/resume-seed.ts`) — nothing survives between turns by object
 * identity.
 */

import { clone, create } from "@bufbuild/protobuf";
import type { RunStatus } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { TurnRowsSchema, type TurnRows } from "../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";

import { TranscriptBuilder } from "../../harness/transcript/builder.js";
import type { BackgroundStopChannel, TurnSink, UsageDelta } from "../../harness/types.js";
import { NO_TURN_INPUT, type TurnInputChannel } from "../../harness/turn-input.js";
import type { CasTouchedReader } from "../../shared/filereview/cas-touched.js";
import { TimingRecorder } from "../../shared/cold-start-timing.js";
import { emptyStatus } from "../proto-helpers.js";

/** One call the adapter made on the sink, in the order it made it. */
export type SinkEvent =
  | { readonly kind: "persist" }
  | { readonly kind: "activity"; readonly detail: string | undefined }
  | { readonly kind: "usage"; readonly delta: UsageDelta }
  | { readonly kind: "progress"; readonly label: string }
  | { readonly kind: "bind"; readonly harnessStateId: string }
  | { readonly kind: "cas-observations" };

export interface RecordingTurnSinkOptions {
  /** The status this turn writes; a fresh empty one when omitted. */
  readonly status?: RunStatus;
  /** The rows this turn folds into; fresh empty ones when omitted. */
  readonly rows?: TurnRows;
  /** The execution the builder names in its log lines; the kit's driver passes its own. */
  readonly executionId?: string;
  /** When set, `bindHarnessState` rejects with this error (a failed session write). */
  readonly bindRejectsWith?: Error;
  /** The turn's input channel (`message-queue.ts`); one that never has input when omitted. */
  readonly input?: TurnInputChannel;
}

export class RecordingTurnSink implements TurnSink {
  readonly status: RunStatus;
  readonly rows: TurnRows;
  /** The one builder over `rows`, as the runtime hands every adapter; the fake creates its rows through it. */
  readonly transcript: TranscriptBuilder;
  readonly stopSignal: AbortSignal;
  readonly yieldSignal: AbortSignal;
  readonly setupTiming = new TimingRecorder();
  readonly input: TurnInputChannel;
  readonly backgroundStops: BackgroundStopChannel = {
    onStop: (listener) => {
      this.backgroundStopListeners.add(listener);
      return () => this.backgroundStopListeners.delete(listener);
    },
  };

  private readonly backgroundStopListeners = new Set<(callId: string) => void>();
  private readonly controller = new AbortController();
  private readonly yieldController = new AbortController();
  private readonly log: SinkEvent[] = [];
  private readonly bindRejectsWith: Error | undefined;

  constructor(options: RecordingTurnSinkOptions = {}) {
    this.status = options.status ?? emptyStatus();
    this.rows = options.rows ?? create(TurnRowsSchema);
    this.transcript = new TranscriptBuilder(options.executionId ?? "kit-exec", this.rows, this.status);
    this.stopSignal = this.controller.signal;
    this.yieldSignal = this.yieldController.signal;
    this.bindRejectsWith = options.bindRejectsWith;
    this.input = options.input ?? NO_TURN_INPUT;
  }

  /** The rows as the turn began (the runtime's seed), once the driver marks them; empty until then. */
  seeded: TurnRows = create(TurnRowsSchema);

  /** Record the rows as they stand as the turn's start: what the runtime seeded before the engine ran. */
  markSeeded(): void {
    this.seeded = clone(TurnRowsSchema, this.rows);
  }

  /** Stop the turn from the outside, the way the runtime would. */
  abort(reason?: unknown): void {
    this.controller.abort(reason);
  }

  /** A person stops one background command, the way the runtime's pump hands it on. */
  stopBackground(callId: string): void {
    for (const listener of [...this.backgroundStopListeners]) listener(callId);
  }

  /** Ask the turn to yield at its next durable step boundary, the way a draining runtime would. */
  requestYield(): void {
    this.yieldController.abort();
  }

  async requestPersist(): Promise<void> {
    this.log.push({ kind: "persist" });
  }

  recordActivity(detail?: string): void {
    this.log.push({ kind: "activity", detail });
  }

  reportUsage(delta: UsageDelta): void {
    this.log.push({ kind: "usage", delta });
  }

  async reportProgress(label: string): Promise<void> {
    this.log.push({ kind: "progress", label });
  }

  async bindHarnessState(harnessStateId: string): Promise<void> {
    if (this.bindRejectsWith) throw this.bindRejectsWith;
    this.log.push({ kind: "bind", harnessStateId });
  }

  bindCasObservations(read: CasTouchedReader): void {
    this.casObservations = read;
    this.log.push({ kind: "cas-observations" });
  }

  /** The reader the adapter bound, for a test that wants to pull what the engine observed. */
  casObservations: CasTouchedReader | undefined;

  /** Every call, in order. */
  get events(): readonly SinkEvent[] {
    return this.log;
  }

  get persistRequests(): number {
    return this.log.filter((e) => e.kind === "persist").length;
  }

  get activityMarks(): number {
    return this.log.filter((e) => e.kind === "activity").length;
  }

  get usageDeltas(): readonly UsageDelta[] {
    return this.log.flatMap((e) => (e.kind === "usage" ? [e.delta] : []));
  }

  get boundStateIds(): readonly string[] {
    return this.log.flatMap((e) => (e.kind === "bind" ? [e.harnessStateId] : []));
  }

  get progressLabels(): readonly string[] {
    return this.log.flatMap((e) => (e.kind === "progress" ? [e.label] : []));
  }
}
