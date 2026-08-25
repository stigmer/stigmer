/**
 * StreamBroker — ports controller/stream_broker.go: the in-memory
 * broadcast fabric for real-time execution updates (ADR 011's "Stream
 * Broker" responsibility; the OSS stand-in for cloud's Redis streams).
 *
 * Go's shape is a map of executionID → buffered channels (capacity 100)
 * under an RWMutex: Broadcast is non-blocking — a full buffer drops the
 * frame for that subscriber (they catch up on the next one) — and
 * Unsubscribe closes the channel. The TS port keeps the exact delivery
 * semantics on the queue-plus-notify idiom the transport already proved
 * for streams (transport/health.ts watch): each subscription owns a
 * bounded FIFO queue the subscribe generator drains, and a notify hook
 * wakes the drain loop. Node's single-threaded event loop replaces the
 * mutex; the bounded queue replaces the channel buffer.
 *
 * ONE instance serves both routers (serving + in-process): #18's Temporal
 * activities update status through the in-process client, and those
 * broadcasts must reach externally-connected subscribers — the same
 * reason Go exposes GetStreamBroker to its activities. The composition
 * root owns the instance.
 */
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";

import type { Logger } from "../../boot/logger.js";

/**
 * Go's channel buffer size: bursts up to this many undelivered frames per
 * subscriber are absorbed; beyond it, broadcasts drop for that subscriber
 * (stream_broker.go's `make(chan ..., 100)` + non-blocking send).
 */
export const SUBSCRIBER_BUFFER_CAPACITY = 100;

/**
 * One subscriber's delivery state. The subscribe stream loop drains
 * `queue` and parks on `notify`; the broker pushes and wakes. `closed`
 * flips on unsubscribe (Go's close(ch)) so a parked or late consumer
 * observes the end instead of waiting forever.
 */
export interface BrokerSubscription {
  readonly queue: AgentExecution[];
  notify: (() => void) | undefined;
  closed: boolean;
}

export class StreamBroker {
  private readonly subscribers = new Map<string, Set<BrokerSubscription>>();

  constructor(private readonly logger: Logger) {}

  /**
   * Registers a new subscriber for the execution. The caller MUST
   * unsubscribe when done (the subscribe generator's `finally`) — Go's
   * "caller MUST call Unsubscribe" contract, enforced there by defer.
   */
  subscribe(executionId: string): BrokerSubscription {
    const subscription: BrokerSubscription = {
      queue: [],
      notify: undefined,
      closed: false,
    };
    const set = this.subscribers.get(executionId) ?? new Set();
    set.add(subscription);
    this.subscribers.set(executionId, set);
    this.logger.debug("New subscriber registered", {
      executionId,
      totalSubscribers: set.size,
    });
    return subscription;
  }

  /** Removes and closes a subscription; idempotent (Go Unsubscribe). */
  unsubscribe(executionId: string, subscription: BrokerSubscription): void {
    const set = this.subscribers.get(executionId);
    if (set === undefined || !set.has(subscription)) {
      return;
    }
    set.delete(subscription);
    subscription.closed = true;
    subscription.notify?.();
    subscription.notify = undefined;
    this.logger.debug("Subscriber unregistered", {
      executionId,
      remainingSubscribers: set.size,
    });
    if (set.size === 0) {
      this.subscribers.delete(executionId);
    }
  }

  /**
   * Delivers an execution update to every active subscriber of its id.
   * Non-blocking by construction: a subscriber at buffer capacity drops
   * THIS frame (it catches up on the next broadcast) — Go's select/default
   * arm, warn included.
   */
  broadcast(execution: AgentExecution): void {
    const executionId = execution.metadata?.id ?? "";
    if (executionId === "") {
      return;
    }
    const set = this.subscribers.get(executionId);
    if (set === undefined || set.size === 0) {
      return;
    }
    this.logger.debug("Broadcasting execution update", {
      executionId,
      subscribers: set.size,
    });
    for (const subscription of set) {
      if (subscription.queue.length >= SUBSCRIBER_BUFFER_CAPACITY) {
        this.logger.warn("Subscriber channel full, dropping update", {
          executionId,
        });
        continue;
      }
      subscription.queue.push(execution);
      subscription.notify?.();
      subscription.notify = undefined;
    }
  }

  /** Active subscriber count for an execution (Go GetSubscriberCount). */
  getSubscriberCount(executionId: string): number {
    return this.subscribers.get(executionId)?.size ?? 0;
  }
}
