/**
 * SessionEventBroker: the in-memory fan-out of a session's events to its
 * live streams (streamEvents), keyed by session. Every write that appends
 * events publishes them here after its transaction commits, so a stream
 * never shows an event the log does not hold.
 *
 * It differs from the run snapshot broker (run/stream-broker.ts) on one
 * rule. A dropped snapshot is harmless, the next one supersedes it; a
 * dropped event is gone. So a stream that falls more than
 * `SESSION_EVENT_SUBSCRIBER_CAPACITY` frames behind is ENDED (the stream
 * answers RESOURCE_EXHAUSTED, and its client lists from the last event it
 * saw), never silently thinned.
 *
 * Previews (event_start, event_delta) are broadcast only, never stored,
 * and only to streams that asked for the previewed type in event_deltas.
 * A delta streams part of an agent.message (Managed Agents previews
 * agent.thinking with a start only), so a delta reaches the streams that
 * asked for agent.message.
 *
 * One instance serves both routers (serving and in-process), as the run
 * broker does; the composition root owns it. A stream across server
 * replicas would page by seq; the editions run one replica today.
 *
 * Proven by __tests__/broker.test.ts.
 */
import { create } from "@bufbuild/protobuf";

import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import type { SessionEventPreview } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import {
  StreamSessionEventsResponseSchema,
  type StreamSessionEventsResponse,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";

import type { Logger } from "../../../boot/logger.js";

/**
 * The most frames one stream may have undelivered. One append carries at
 * most 1000 events and 1000 previews (AppendSessionEventsInput), so a
 * stream that is draining keeps up with any single batch; one that cannot
 * drain two batches' worth is ended rather than fed silently partial.
 */
export const SESSION_EVENT_SUBSCRIBER_CAPACITY = 4096;

/** One stream's delivery state: the stream loop drains `queue` and parks on `notify`. */
export interface SessionEventSubscription {
  readonly queue: StreamSessionEventsResponse[];
  /** The previewed types this stream asked for. */
  readonly deltaTypes: ReadonlySet<string>;
  notify: (() => void) | undefined;
  /** Set when the stream fell behind and was ended. */
  overflowed: boolean;
  closed: boolean;
}

export class SessionEventBroker {
  private readonly subscribers = new Map<string, Set<SessionEventSubscription>>();

  constructor(private readonly logger: Logger) {}

  /** Registers a stream; the caller MUST unsubscribe when it ends. */
  subscribe(sessionId: string, deltaTypes: ReadonlyArray<string>): SessionEventSubscription {
    const subscription: SessionEventSubscription = {
      queue: [],
      deltaTypes: new Set(deltaTypes),
      notify: undefined,
      overflowed: false,
      closed: false,
    };
    const set = this.subscribers.get(sessionId) ?? new Set();
    set.add(subscription);
    this.subscribers.set(sessionId, set);
    return subscription;
  }

  /** Removes and closes a subscription; idempotent. */
  unsubscribe(sessionId: string, subscription: SessionEventSubscription): void {
    const set = this.subscribers.get(sessionId);
    if (set === undefined || !set.delete(subscription)) {
      return;
    }
    this.close(subscription);
    if (set.size === 0) {
      this.subscribers.delete(sessionId);
    }
  }

  /** Delivers committed events, in order, to every stream of the session. */
  publish(sessionId: string, events: ReadonlyArray<SessionEvent>): void {
    if (events.length === 0) {
      return;
    }
    this.deliver(
      sessionId,
      events.map((event) =>
        create(StreamSessionEventsResponseSchema, { frame: { case: "event", value: event } }),
      ),
      () => true,
    );
  }

  /** Delivers previews to the streams that asked for the previewed type. */
  publishPreviews(sessionId: string, previews: ReadonlyArray<SessionEventPreview>): void {
    for (const preview of previews) {
      let frame: StreamSessionEventsResponse;
      let type: string;
      switch (preview.preview.case) {
        case "eventStart":
          frame = create(StreamSessionEventsResponseSchema, {
            frame: { case: "eventStart", value: preview.preview.value },
          });
          type = preview.preview.value.event?.type ?? "";
          break;
        case "eventDelta":
          frame = create(StreamSessionEventsResponseSchema, {
            frame: { case: "eventDelta", value: preview.preview.value },
          });
          type = "agent.message";
          break;
        case undefined:
          continue;
        default: {
          const exhaustive: never = preview.preview;
          throw new Error(`unknown preview ${String(exhaustive)}`);
        }
      }
      this.deliver(sessionId, [frame], (s) => s.deltaTypes.has(type));
    }
  }

  /** Streams open on a session. */
  subscriberCount(sessionId: string): number {
    return this.subscribers.get(sessionId)?.size ?? 0;
  }

  private deliver(
    sessionId: string,
    frames: ReadonlyArray<StreamSessionEventsResponse>,
    wants: (subscription: SessionEventSubscription) => boolean,
  ): void {
    const set = this.subscribers.get(sessionId);
    if (set === undefined) {
      return;
    }
    for (const subscription of set) {
      if (subscription.closed || !wants(subscription)) {
        continue;
      }
      if (subscription.queue.length + frames.length > SESSION_EVENT_SUBSCRIBER_CAPACITY) {
        this.logger.warn("A session event stream fell behind; ending it", { sessionId });
        subscription.overflowed = true;
        subscription.queue.length = 0;
        set.delete(subscription);
        this.close(subscription);
        continue;
      }
      subscription.queue.push(...frames);
      subscription.notify?.();
      subscription.notify = undefined;
    }
    if (set.size === 0) {
      this.subscribers.delete(sessionId);
    }
  }

  private close(subscription: SessionEventSubscription): void {
    subscription.closed = true;
    subscription.notify?.();
    subscription.notify = undefined;
  }
}
