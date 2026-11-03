/**
 * SessionEventBroker: the in-memory bell of a session's live streams
 * (streamEvents), keyed by session, and the fan-out of its previews. Every
 * write that appends events rings it after its transaction commits; the
 * stream then reads the store after the last seq it sent (stream.ts). No
 * event is copied here: the log is the one source of what a stream sends,
 * so a stream is exactly-once and in order by construction, whichever
 * server process wrote the event, and a slow reader only lags.
 *
 * The bell is an optimisation, not the delivery: an event another server
 * process committed rings no bell here, and the stream's tail read finds
 * it (stream.ts). A second process serves beside this one during a rolling
 * update, when the outgoing and the incoming server serve together.
 *
 * Previews (event_start, event_delta) are broadcast only, never stored,
 * and only to streams that asked for the previewed type in event_deltas.
 * A delta streams part of an agent.message (Managed Agents previews
 * agent.thinking with a start only), so a delta reaches the streams that
 * asked for agent.message. A running tool's output fragment
 * (stigmer.tool_output_delta, Stigmer's own) reaches the streams that asked
 * for that type, as a turn's liveness (stigmer.run.liveness) does. A stream's undelivered previews are bounded: past
 * `SESSION_EVENT_PREVIEW_CAPACITY` frames or
 * `SESSION_EVENT_PREVIEW_MAX_BYTES` bytes its queued previews are DROPPED,
 * never the stream, and the event and tool-use ids they named are
 * remembered so their later fragments are skipped too: a live message never
 * shows text with a hole in it, and the stored event that follows replaces
 * the preview whole.
 *
 * A turn's liveness is the one preview the broker also keeps: the newest
 * per working turn (keyed by session, then run), so a stream that opens
 * mid-turn, a reload or a reconnect, learns what the turn is doing at once
 * instead of at the runner's next interval send (stigmer#2657). The stream
 * asks for them right after its first read of the log (stream.ts), because
 * a client's fold drops a liveness for a turn it has not read yet.
 * `currentLiveness` moves each age forward by the time the broker held it,
 * on a monotonic clock. A turn's entry goes when its stigmer.run.status
 * says it stopped working (waiting, paused or ended: the runner stops
 * sending then, and a resumed turn sends again at once), and is never
 * handed back once `SESSION_EVENT_LIVENESS_KEPT_MS` passes without a newer
 * one, which covers a runner that died before its run's end was written.
 * Like the bell, it is this process's memory only: during a rolling update
 * a stream on the other process waits for the next interval send.
 *
 * Shutdown closes the broker first (boot/compose.ts): every stream ends
 * with UNAVAILABLE and a new one is refused, so a watcher resumes on the
 * server that stays instead of waiting on one that is leaving.
 *
 * One more bell rings across sessions: a write whose events include a
 * `session.status_idle` rings its organization's attention streams
 * (attention.ts, `sessionIdleBellOf`), each of which reads that
 * organization's idles from the store, as an event stream reads its
 * session's.
 *
 * One instance serves both routers (serving and in-process), as the run
 * broker does; the composition root owns it.
 *
 * Proven by __tests__/broker.test.ts.
 */
import { clone, create, toBinary } from "@bufbuild/protobuf";
import { DurationSchema, type Duration } from "@bufbuild/protobuf/wkt";

import {
  RunLivenessSchema,
  type RunLiveness,
  type SessionEvent,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import type { SessionEventPreview } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import {
  StreamSessionEventsResponseSchema,
  type StreamSessionEventsResponse,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";

import type { Logger } from "../../../boot/logger.js";

/**
 * The most previews one stream may have undelivered. One append carries at
 * most 1000 previews (AppendSessionEventsInput), so a stream that is
 * draining keeps up with any single batch.
 */
export const SESSION_EVENT_PREVIEW_CAPACITY = 4096;

/**
 * The most preview bytes one stream may have undelivered. A preview can be
 * 256 KiB, so the frame cap alone would let one stalled reader hold a
 * gigabyte of a busy session.
 */
export const SESSION_EVENT_PREVIEW_MAX_BYTES = 32 * 1024 * 1024;

/**
 * How many dropped preview ids a stream remembers. A fragment of an id
 * forgotten past this is let through; the fold ignores a fragment whose
 * draft it never opened, so only a draft opened before the drop and still
 * streaming after this many newer drops could show its hole.
 */
export const SESSION_EVENT_DROPPED_IDS_KEPT = 4096;

/** The previewed type a stream names in event_deltas to receive turns' liveness. */
export const SESSION_EVENT_LIVENESS_TYPE = "stigmer.run.liveness";

/**
 * How long a turn's liveness is kept without a newer one. The runner sends
 * one at least this often while the turn works (RunLiveness, event.proto),
 * and this is also the console's slow watch (a follow that delivers nothing
 * this long), so a kept liveness never vouches for a silence the console
 * would already call slow. Past it, the turn's runner is presumed gone.
 */
export const SESSION_EVENT_LIVENESS_KEPT_MS = 60_000;

/** The phases (stigmer.run.status) in which a turn's runner sends no liveness. */
const LIVENESS_STOPS_IN: ReadonlySet<string> = new Set(["waiting", "paused", "completed", "failed", "cancelled", "terminated"]);

/** A turn's newest liveness, and when (the broker's clock) it arrived. */
interface KeptLiveness {
  readonly liveness: RunLiveness;
  readonly at: number;
}

/** Where an organization's attention streams subscribe: a key no session id takes. */
export function sessionIdleBellOf(org: string): string {
  return `\u0000session.status_idle:${org}`;
}

/** The reason a stream ends with when the broker closes. */
export const SESSION_EVENT_BROKER_CLOSED_MESSAGE =
  "the server is restarting; stream again with after_seq set to the last event received";

/** One stream's delivery state: the stream loop drains `previews` and parks on `notify`. */
export interface SessionEventSubscription {
  /** Undelivered previews, in publish order. */
  readonly previews: StreamSessionEventsResponse[];
  /** The encoded size of each queued preview, in queue order. */
  readonly sizes: number[];
  /** The event or tool-use id each queued preview names, in queue order; undefined for a turn's liveness, which names none. */
  readonly ids: (string | undefined)[];
  /** The sum of `sizes`. */
  queuedBytes: number;
  /** The previewed types this stream asked for. */
  readonly deltaTypes: ReadonlySet<string>;
  /** The event and tool-use ids whose previews were dropped, oldest first. */
  readonly droppedIds: Set<string>;
  /** Set when events were committed since the stream last read the store. */
  dirty: boolean;
  notify: (() => void) | undefined;
  /** Set when the stream left or the broker closed. */
  closed: boolean;
  /** Why the broker closed this stream; undefined when the stream left. */
  closedBecause: string | undefined;
}

export class SessionEventBroker {
  private readonly subscribers = new Map<string, Set<SessionEventSubscription>>();
  /** Each working turn's newest liveness, by session, then run. */
  private readonly kept = new Map<string, Map<string, KeptLiveness>>();
  private sweptAt = -Infinity;
  private closedBecause: string | undefined;

  /**
   * `now` is a monotonic millisecond clock, injectable for tests: it only
   * measures how long a liveness was kept, which a wall-clock step must not
   * stretch or reverse.
   */
  constructor(
    private readonly logger: Logger,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /**
   * Registers a stream; the caller MUST unsubscribe when it ends. Once the
   * broker is closed the subscription comes back already closed.
   */
  subscribe(sessionId: string, deltaTypes: ReadonlyArray<string>): SessionEventSubscription {
    const subscription: SessionEventSubscription = {
      previews: [],
      sizes: [],
      ids: [],
      queuedBytes: 0,
      deltaTypes: new Set(deltaTypes),
      droppedIds: new Set(),
      dirty: false,
      notify: undefined,
      closed: this.closedBecause !== undefined,
      closedBecause: this.closedBecause,
    };
    if (subscription.closed) {
      return subscription;
    }
    const set = this.subscribers.get(sessionId) ?? new Set();
    set.add(subscription);
    this.subscribers.set(sessionId, set);
    return subscription;
  }

  /** Removes and closes a subscription; idempotent. */
  unsubscribe(sessionId: string, subscription: SessionEventSubscription): void {
    const set = this.subscribers.get(sessionId);
    if (set === undefined || !set.delete(subscription)) {
      subscription.closed = true;
      return;
    }
    this.end(subscription, undefined);
    if (set.size === 0) {
      this.subscribers.delete(sessionId);
    }
  }

  /**
   * Ends every stream and refuses new ones, each with `reason`; idempotent.
   * The server calls it as it starts to leave.
   */
  close(reason: string = SESSION_EVENT_BROKER_CLOSED_MESSAGE): void {
    if (this.closedBecause !== undefined) {
      return;
    }
    this.closedBecause = reason;
    for (const set of this.subscribers.values()) {
      for (const subscription of set) {
        this.end(subscription, reason);
      }
    }
    this.subscribers.clear();
    this.kept.clear();
  }

  /**
   * Rings the bell of every stream of the session once events committed,
   * and the organization's idle bell when they carry an idle. The events
   * are not copied: each stream reads them from the store.
   */
  publish(sessionId: string, org: string, events: ReadonlyArray<SessionEvent>): void {
    if (events.length === 0) {
      return;
    }
    for (const event of events) {
      if (event.event.case === "stigmerRunStatus" && LIVENESS_STOPS_IN.has(event.event.value.phase)) {
        this.forget(sessionId, event.runId);
      }
    }
    const idle = org !== "" && events.some((event) => event.event.case === "sessionStatusIdle");
    const bells = idle ? [sessionId, sessionIdleBellOf(org)] : [sessionId];
    for (const bell of bells) {
      for (const subscription of this.subscribers.get(bell) ?? []) {
        subscription.dirty = true;
        this.wake(subscription);
      }
    }
  }

  /** Delivers previews to the streams that asked for the previewed type. */
  publishPreviews(sessionId: string, previews: ReadonlyArray<SessionEventPreview>): void {
    for (const preview of previews) {
      let frame: StreamSessionEventsResponse;
      let type: string;
      let id: string | undefined;
      switch (preview.preview.case) {
        case "eventStart":
          frame = create(StreamSessionEventsResponseSchema, {
            frame: { case: "eventStart", value: preview.preview.value },
          });
          type = preview.preview.value.event?.type ?? "";
          id = preview.preview.value.event?.id ?? "";
          break;
        case "eventDelta":
          frame = create(StreamSessionEventsResponseSchema, {
            frame: { case: "eventDelta", value: preview.preview.value },
          });
          type = "agent.message";
          id = preview.preview.value.eventId;
          break;
        case "stigmerToolOutputDelta":
          frame = create(StreamSessionEventsResponseSchema, {
            frame: { case: "stigmerToolOutputDelta", value: preview.preview.value },
          });
          type = "stigmer.tool_output_delta";
          id = preview.preview.value.toolUseId;
          break;
        case "stigmerRunLiveness":
          frame = create(StreamSessionEventsResponseSchema, {
            frame: { case: "stigmerRunLiveness", value: preview.preview.value },
          });
          type = SESSION_EVENT_LIVENESS_TYPE;
          // Each liveness is the whole of what the turn has open: a dropped
          // one costs nothing the next does not say again, so it is never
          // remembered and never skipped.
          id = undefined;
          this.keep(sessionId, preview.preview.value);
          break;
        case undefined:
          continue;
        /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
        default: {
          const exhaustive: never = preview.preview;
          throw new Error(`unknown preview ${String(exhaustive)}`);
        }
      }
      this.deliverPreview(sessionId, frame, type, id);
    }
  }

  /** The next undelivered preview of a subscription, or undefined when none is queued. */
  take(subscription: SessionEventSubscription): StreamSessionEventsResponse | undefined {
    const frame = subscription.previews.shift();
    subscription.queuedBytes -= subscription.sizes.shift() ?? 0;
    subscription.ids.shift();
    return frame;
  }

  /**
   * One frame per working turn of the session: its newest liveness, every
   * age moved forward by the time it was kept. Empty when no turn of the
   * session sent one within `SESSION_EVENT_LIVENESS_KEPT_MS`.
   */
  currentLiveness(sessionId: string): StreamSessionEventsResponse[] {
    const runs = this.kept.get(sessionId);
    if (runs === undefined) {
      return [];
    }
    const at = this.now();
    const frames: StreamSessionEventsResponse[] = [];
    for (const kept of runs.values()) {
      const heldMs = at - kept.at;
      if (heldMs >= SESSION_EVENT_LIVENESS_KEPT_MS) {
        continue;
      }
      frames.push(
        create(StreamSessionEventsResponseSchema, {
          frame: { case: "stigmerRunLiveness", value: aged(kept.liveness, heldMs) },
        }),
      );
    }
    return frames;
  }

  /** Streams open on a session. */
  subscriberCount(sessionId: string): number {
    return this.subscribers.get(sessionId)?.size ?? 0;
  }

  /** `id` undefined: a snapshot preview, never remembered when dropped and never skipped. */
  private deliverPreview(sessionId: string, frame: StreamSessionEventsResponse, type: string, id: string | undefined): void {
    const set = this.subscribers.get(sessionId);
    if (set === undefined) {
      return;
    }
    let size: number | undefined;
    for (const subscription of set) {
      if (!subscription.deltaTypes.has(type) || (id !== undefined && subscription.droppedIds.has(id))) {
        continue;
      }
      size ??= toBinary(StreamSessionEventsResponseSchema, frame).length;
      if (
        subscription.previews.length + 1 > SESSION_EVENT_PREVIEW_CAPACITY ||
        subscription.queuedBytes + size > SESSION_EVENT_PREVIEW_MAX_BYTES
      ) {
        this.logger.warn("A session event stream fell behind on previews; dropping them", { sessionId });
        for (const dropped of [...subscription.ids, id]) {
          if (dropped !== undefined) {
            remember(subscription, dropped);
          }
        }
        subscription.previews.length = 0;
        subscription.sizes.length = 0;
        subscription.ids.length = 0;
        subscription.queuedBytes = 0;
        continue;
      }
      subscription.previews.push(frame);
      subscription.sizes.push(size);
      subscription.ids.push(id);
      subscription.queuedBytes += size;
      this.wake(subscription);
    }
  }

  /** Keeps a turn's liveness in place of the one before; nothing once closed. */
  private keep(sessionId: string, liveness: RunLiveness): void {
    if (this.closedBecause !== undefined || liveness.runId === "") {
      return;
    }
    const at = this.now();
    this.sweep(at);
    const runs = this.kept.get(sessionId) ?? new Map<string, KeptLiveness>();
    runs.set(liveness.runId, { liveness, at });
    this.kept.set(sessionId, runs);
  }

  private forget(sessionId: string, runId: string): void {
    const runs = this.kept.get(sessionId);
    if (runs?.delete(runId) === true && runs.size === 0) {
      this.kept.delete(sessionId);
    }
  }

  /**
   * Drops every liveness kept past its bound, at most once per bound, so a
   * session nobody streams again does not keep a dead turn's forever.
   */
  private sweep(at: number): void {
    if (at - this.sweptAt < SESSION_EVENT_LIVENESS_KEPT_MS) {
      return;
    }
    this.sweptAt = at;
    for (const [sessionId, runs] of this.kept) {
      for (const [runId, kept] of runs) {
        if (at - kept.at >= SESSION_EVENT_LIVENESS_KEPT_MS) {
          runs.delete(runId);
        }
      }
      if (runs.size === 0) {
        this.kept.delete(sessionId);
      }
    }
  }

  private wake(subscription: SessionEventSubscription): void {
    subscription.notify?.();
    subscription.notify = undefined;
  }

  private end(subscription: SessionEventSubscription, reason: string | undefined): void {
    subscription.closed = true;
    subscription.closedBecause = reason;
    this.wake(subscription);
  }
}

/**
 * Remembers a dropped id, forgetting the oldest past the bound. A preview
 * that names no id (a start with no event) is remembered as the empty id,
 * so no later preview naming none slips through either.
 */
function remember(subscription: SessionEventSubscription, id: string): void {
  subscription.droppedIds.delete(id);
  subscription.droppedIds.add(id);
  for (const oldest of subscription.droppedIds) {
    if (subscription.droppedIds.size <= SESSION_EVENT_DROPPED_IDS_KEPT) {
      break;
    }
    subscription.droppedIds.delete(oldest);
  }
}

/** A copy of `liveness` with every age (each operation's elapsed, the model wait) longer by `ms`. */
function aged(liveness: RunLiveness, ms: number): RunLiveness {
  const copy = clone(RunLivenessSchema, liveness);
  for (const operation of copy.operations) {
    if (operation.elapsed !== undefined) {
      operation.elapsed = longer(operation.elapsed, ms);
    }
  }
  if (copy.awaitingModelFor !== undefined) {
    copy.awaitingModelFor = longer(copy.awaitingModelFor, ms);
  }
  return copy;
}

function longer(duration: Duration, ms: number): Duration {
  const nanos = duration.seconds * 1_000_000_000n + BigInt(duration.nanos) + BigInt(Math.round(ms * 1_000_000));
  return create(DurationSchema, { seconds: nanos / 1_000_000_000n, nanos: Number(nanos % 1_000_000_000n) });
}
