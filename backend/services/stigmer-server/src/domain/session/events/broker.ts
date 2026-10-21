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
 * for that type. A stream's undelivered previews are bounded: past
 * `SESSION_EVENT_PREVIEW_CAPACITY` frames or
 * `SESSION_EVENT_PREVIEW_MAX_BYTES` bytes its queued previews are DROPPED,
 * never the stream, and the event and tool-use ids they named are
 * remembered so their later fragments are skipped too: a live message never
 * shows text with a hole in it, and the stored event that follows replaces
 * the preview whole.
 *
 * Shutdown closes the broker first (boot/compose.ts): every stream ends
 * with UNAVAILABLE and a new one is refused, so a watcher resumes on the
 * server that stays instead of waiting on one that is leaving.
 *
 * One instance serves both routers (serving and in-process), as the run
 * broker does; the composition root owns it.
 *
 * Proven by __tests__/broker.test.ts.
 */
import { create, toBinary } from "@bufbuild/protobuf";

import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
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

/** The reason a stream ends with when the broker closes. */
export const SESSION_EVENT_BROKER_CLOSED_MESSAGE =
  "the server is restarting; stream again with after_seq set to the last event received";

/** One stream's delivery state: the stream loop drains `previews` and parks on `notify`. */
export interface SessionEventSubscription {
  /** Undelivered previews, in publish order. */
  readonly previews: StreamSessionEventsResponse[];
  /** The encoded size of each queued preview, in queue order. */
  readonly sizes: number[];
  /** The event or tool-use id each queued preview names, in queue order. */
  readonly ids: string[];
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
  private closedBecause: string | undefined;

  constructor(private readonly logger: Logger) {}

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
  }

  /**
   * Rings the bell of every stream of the session once events committed.
   * The events are not copied: each stream reads them from the store.
   */
  publish(sessionId: string, events: ReadonlyArray<SessionEvent>): void {
    if (events.length === 0) {
      return;
    }
    for (const subscription of this.subscribers.get(sessionId) ?? []) {
      subscription.dirty = true;
      this.wake(subscription);
    }
  }

  /** Delivers previews to the streams that asked for the previewed type. */
  publishPreviews(sessionId: string, previews: ReadonlyArray<SessionEventPreview>): void {
    for (const preview of previews) {
      let frame: StreamSessionEventsResponse;
      let type: string;
      let id: string;
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

  /** Streams open on a session. */
  subscriberCount(sessionId: string): number {
    return this.subscribers.get(sessionId)?.size ?? 0;
  }

  private deliverPreview(sessionId: string, frame: StreamSessionEventsResponse, type: string, id: string): void {
    const set = this.subscribers.get(sessionId);
    if (set === undefined) {
      return;
    }
    let size: number | undefined;
    for (const subscription of set) {
      if (!subscription.deltaTypes.has(type) || subscription.droppedIds.has(id)) {
        continue;
      }
      size ??= toBinary(StreamSessionEventsResponseSchema, frame).length;
      if (
        subscription.previews.length + 1 > SESSION_EVENT_PREVIEW_CAPACITY ||
        subscription.queuedBytes + size > SESSION_EVENT_PREVIEW_MAX_BYTES
      ) {
        this.logger.warn("A session event stream fell behind on previews; dropping them", { sessionId });
        for (const dropped of [...subscription.ids, id]) {
          remember(subscription, dropped);
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
