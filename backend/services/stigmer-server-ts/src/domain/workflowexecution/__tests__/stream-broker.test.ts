/**
 * Pins the StreamBroker delivery semantics against Go stream_broker.go:
 * per-execution fan-out, the non-blocking bounded buffer (drop at
 * capacity, catch up on the next frame), idempotent unsubscribe with the
 * closed flag + notify wake, and the missing-metadata no-op.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";

import { createLogger } from "../../../boot/logger.js";
import {
  StreamBroker,
  SUBSCRIBER_BUFFER_CAPACITY,
} from "../stream-broker.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

function frame(id: string, phase = ExecutionPhase.EXECUTION_IN_PROGRESS): WorkflowExecution {
  return create(WorkflowExecutionSchema, {
    metadata: { id, name: id },
    status: { phase },
  });
}

describe("StreamBroker (stream_broker.go semantics)", () => {
  it("fans out to every subscriber of the execution, and only that execution", () => {
    const broker = new StreamBroker(silentLogger);
    const a1 = broker.subscribe("wfx_a");
    const a2 = broker.subscribe("wfx_a");
    const b = broker.subscribe("wfx_b");

    broker.broadcast(frame("wfx_a"));

    expect(a1.queue).toHaveLength(1);
    expect(a2.queue).toHaveLength(1);
    expect(b.queue).toHaveLength(0);
    expect(broker.getSubscriberCount("wfx_a")).toBe(2);
  });

  it("notify fires once per push and is cleared after", () => {
    const broker = new StreamBroker(silentLogger);
    const subscription = broker.subscribe("wfx_notify");
    let woken = 0;
    subscription.notify = () => {
      woken += 1;
    };
    broker.broadcast(frame("wfx_notify"));
    expect(woken).toBe(1);
    expect(subscription.notify, "notify is one-shot").toBeUndefined();
  });

  it("drops the frame for a subscriber at buffer capacity (non-blocking send)", () => {
    const broker = new StreamBroker(silentLogger);
    const full = broker.subscribe("wfx_full");
    const healthy = broker.subscribe("wfx_full");
    for (let i = 0; i < SUBSCRIBER_BUFFER_CAPACITY; i++) {
      full.queue.push(frame("wfx_full"));
    }

    broker.broadcast(frame("wfx_full", ExecutionPhase.EXECUTION_COMPLETED));

    expect(full.queue, "full buffer drops THIS frame").toHaveLength(
      SUBSCRIBER_BUFFER_CAPACITY,
    );
    expect(healthy.queue, "healthy sibling still receives").toHaveLength(1);
  });

  it("unsubscribe closes, wakes a parked consumer, and is idempotent", () => {
    const broker = new StreamBroker(silentLogger);
    const subscription = broker.subscribe("wfx_close");
    let woken = false;
    subscription.notify = () => {
      woken = true;
    };

    broker.unsubscribe("wfx_close", subscription);
    expect(subscription.closed).toBe(true);
    expect(woken, "a parked consumer observes the close").toBe(true);
    expect(broker.getSubscriberCount("wfx_close")).toBe(0);

    // Idempotent (Go's missing-channel early return).
    broker.unsubscribe("wfx_close", subscription);
    expect(broker.getSubscriberCount("wfx_close")).toBe(0);
  });

  it("a broadcast without metadata id is a no-op", () => {
    const broker = new StreamBroker(silentLogger);
    const subscription = broker.subscribe("");
    broker.broadcast(create(WorkflowExecutionSchema, {}));
    expect(subscription.queue).toHaveLength(0);
  });
});
