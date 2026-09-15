/**
 * Drive Cursor SDK events through the REAL pair the harness runs in production
 * — `CursorTranslator` into `TranscriptBuilder` over an `AgentExecutionStatus`
 * — and hand back what they built. The unit-test seam that replaced
 * `new MessageAccumulator(messages, options)` at S4 M4 (the accumulator folded
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
import { AgentExecutionStatusSchema, type AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { TranscriptBuilder } from "../../../harness/transcript/builder.js";
import { CursorTranslator, type CursorTranslatorOptions } from "../translator.js";

export interface CursorFoldOptions {
  /** The status to build into; a fresh empty one when omitted. Its `messages` are the translator's seed. */
  readonly status?: AgentExecutionStatus;
  readonly policies?: CursorTranslatorOptions["policies"];
  readonly leases?: CursorTranslatorOptions["leases"];
}

export class CursorFold {
  readonly status: AgentExecutionStatus;
  readonly translator: CursorTranslator;
  readonly builder: TranscriptBuilder;

  constructor(options: CursorFoldOptions = {}) {
    this.status = options.status ?? create(AgentExecutionStatusSchema, {});
    this.translator = new CursorTranslator({
      policies: options.policies ?? new Map(),
      leases: options.leases ?? { global: false, categories: new Set() },
      seeded: this.status.messages,
    });
    this.builder = new TranscriptBuilder("exec-fold", this.status);
  }

  /** One stream event, translated and folded, then the deltas queued so far — the loop's order. */
  event(event: SDKMessage): this {
    for (const e of this.translator.translate(event)) this.builder.apply(e);
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
    return this.status.messages;
  }

  /** Every root row, in transcript order. */
  rows(): ToolCall[] {
    return this.status.messages.flatMap((m) => m.toolCalls);
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
