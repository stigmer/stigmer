/**
 * Drive Cursor SDK events through the REAL pair the harness runs in production
 * — `CursorTranslator` into `TranscriptBuilder` over the turn's `TurnRows`
 * — and hand back what they built. The unit-test seam that replaced
 * `new <accumulator>(messages, options)` in #1097 (the accumulator folded
 * rows itself; now the translator emits events and the shared builder folds
 * them), so the arms that read a row's shape after a sequence of SDK events
 * keep their shape while the module under them changed.
 *
 * The same shape as the native translator's local `feedAll` in
 * `execute-deep-agent/__tests__/translator-through-builder.test.ts`, shared
 * here because seven Cursor test files read through it.
 *
 * Deltas follow the loop's discipline (`turn-stream.ts`): `observeDelta`
 * queues, and the queue is drained into the builder after the NEXT stream
 * event — or at {@link CursorFold.drain} for a caller that wants them applied
 * now, the settle's own last drain before `finalize()`.
 */

import { create } from "@bufbuild/protobuf";
import type { InteractionUpdate, SDKMessage } from "@cursor/sdk";
import { RunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { TranscriptBuilder, type TranscriptObserver } from "../../../harness/transcript/builder.js";
import { CursorTranslator, type CursorTranslatorOptions } from "../translator.js";
import { TurnRowsSchema, type AgentMessage, type ToolCall, type TurnRows } from "../../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";

export interface CursorFoldOptions {
  /** The rows to build into; fresh empty ones when omitted. Their `messages` are the translator's seed. */
  readonly turnRows?: TurnRows;
  /**
   * An existing `messages` array to build into BY REFERENCE (a test that
   * hand-built its seeded rows and keeps asserting on the same objects). Wins
   * over `turnRows`'s own array.
   */
  readonly messages?: AgentMessage[];
  readonly mcpDefault?: CursorTranslatorOptions["mcpDefault"];
  readonly leases?: CursorTranslatorOptions["leases"];
  /** The builder's observer, as the runtime passes its turn timeline; a test that moves a fake clock between folds passes one. */
  readonly observer?: TranscriptObserver;
}

export class CursorFold {
  readonly turnRows: TurnRows;
  readonly translator: CursorTranslator;
  readonly builder: TranscriptBuilder;

  constructor(options: CursorFoldOptions = {}) {
    this.turnRows = options.turnRows ?? create(TurnRowsSchema, {});
    if (options.messages) this.turnRows.messages = options.messages;
    this.translator = new CursorTranslator({
      mcpDefault: options.mcpDefault ?? { destructive: new Set(), unlisted: new Set<string>(), leasedServers: new Set() },
      leases: options.leases ?? { global: false, categories: new Set() },
      seeded: this.turnRows.messages,
    });
    this.builder = new TranscriptBuilder("exec-fold", this.turnRows, create(RunStatusSchema, {}), options.observer);
  }

  /** One stream event, translated and folded as one observation, then the deltas queued so far — the loop's order. */
  event(event: SDKMessage): this {
    this.builder.applyObservation(this.translator.translate(event));
    this.drain();
    return this;
  }

  events(...events: SDKMessage[]): this {
    for (const e of events) this.event(e);
    return this;
  }

  /** One delta, queued — applied at the next {@link event} or {@link drain}. */
  delta(update: InteractionUpdate): this {
    this.translator.observeDelta(update);
    return this;
  }

  drain(): this {
    for (const e of this.translator.drainDeltas()) this.builder.apply(e);
    return this;
  }

  finalize(): this {
    this.drain();
    this.builder.finalize();
    return this;
  }

  get messages(): AgentMessage[] {
    return this.turnRows.messages;
  }

  /** Every root row, in transcript order. */
  rows(): ToolCall[] {
    return this.turnRows.messages.flatMap((m) => m.toolCalls);
  }

  row(callId: string): ToolCall {
    const found = this.rows().find((tc) => tc.id === callId);
    if (!found) throw new Error(`CursorFold: no row ${callId}`);
    return found;
  }
}

/** Fold a sequence of stream events into a fresh transcript; the common one-liner. */
export function foldCursorEvents(events: readonly SDKMessage[], options: CursorFoldOptions = {}): CursorFold {
  return new CursorFold(options).events(...events);
}

/**
 * A builder over an existing `messages` array, kept BY REFERENCE (the rows
 * are given the array itself, never a copy), so a boundary test that built
 * its rows by hand can hand them to `reconcileDeniedToolCalls` and keep
 * asserting on the same objects.
 */
export function builderOver(messages: AgentMessage[], executionId = "exec-boundary"): TranscriptBuilder {
  const rows = create(TurnRowsSchema, {});
  rows.messages = messages;
  return new TranscriptBuilder(executionId, rows, create(RunStatusSchema, {}));
}
