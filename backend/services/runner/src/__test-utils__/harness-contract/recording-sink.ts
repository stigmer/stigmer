/**
 * A `TurnSink` that records everything an adapter asks of the runtime.
 *
 * The kit is the runtime stand-in, and this is the runtime's face during one
 * turn: it owns the `AbortController` behind `stopSignal` (so a test can stop
 * the turn from the outside, exactly as the runtime's watchdog, accounting or
 * heartbeat would), and it keeps ONE ordered log of every call the adapter
 * made. Counts and lists are derived from the log on read rather than kept
 * as parallel counters, because the invariants care about ORDER as much as
 * about counts ("bind before the first persist" is an ordering claim).
 *
 * `bindHarnessState` can be made to reject, standing in for a failed session
 * write, so the kit can prove an adapter surfaces a runtime-side failure as
 * `failed` instead of letting it escape `runTurn`.
 *
 * One sink per turn, like the runtime. A reinvocation gets a NEW sink whose
 * `status` is a clone of the previous turn's — the runtime persists and reads
 * back, so nothing survives between turns by object identity.
 */

import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";

import type { TurnSink, UsageDelta } from "../../harness/types.js";
import { TimingRecorder } from "../../shared/cold-start-timing.js";
import { emptyStatus } from "../proto-helpers.js";

/** One call the adapter made on the sink, in the order it made it. */
export type SinkEvent =
  | { readonly kind: "persist" }
  | { readonly kind: "activity"; readonly detail: string | undefined }
  | { readonly kind: "usage"; readonly delta: UsageDelta }
  | { readonly kind: "progress"; readonly label: string }
  | { readonly kind: "bind"; readonly harnessStateId: string };

export interface RecordingTurnSinkOptions {
  /** The status this turn folds into; a fresh empty one when omitted. */
  readonly status?: AgentExecutionStatus;
  /** When set, `bindHarnessState` rejects with this error (a failed session write). */
  readonly bindRejectsWith?: Error;
}

export class RecordingTurnSink implements TurnSink {
  readonly status: AgentExecutionStatus;
  readonly stopSignal: AbortSignal;
  readonly setupTiming = new TimingRecorder();

  private readonly controller = new AbortController();
  private readonly log: SinkEvent[] = [];
  private readonly bindRejectsWith: Error | undefined;

  constructor(options: RecordingTurnSinkOptions = {}) {
    this.status = options.status ?? emptyStatus();
    this.stopSignal = this.controller.signal;
    this.bindRejectsWith = options.bindRejectsWith;
  }

  /** Stop the turn from the outside, the way the runtime would. */
  abort(reason?: unknown): void {
    this.controller.abort(reason);
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
