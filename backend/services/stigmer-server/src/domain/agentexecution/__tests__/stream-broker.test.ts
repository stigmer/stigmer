/**
 * Pins the StreamBroker delivery semantics (stream_broker.go): bounded
 * per-subscriber buffering with drop-on-full (never blocking a
 * broadcast), notify-on-push, idempotent unsubscribe with close
 * signaling, and per-execution isolation.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";

import { createLogger } from "../../../boot/logger.js";
import {
  StreamBroker,
  SUBSCRIBER_BUFFER_CAPACITY,
} from "../stream-broker.js";

function capturingLogger() {
  const lines: Array<{ level: string; message: string }> = [];
  return {
    lines,
    logger: createLogger({
      level: "debug",
      pretty: false,
      write: (line) =>
        lines.push(JSON.parse(line) as { level: string; message: string }),
    }),
  };
}

function frame(id: string, error = "") {
  return create(AgentExecutionSchema, {
    metadata: { id },
    status: { error },
  });
}

describe("StreamBroker", () => {
  it("delivers to every subscriber of the execution, none of another's", () => {
    const { logger } = capturingLogger();
    const broker = new StreamBroker(logger);
    const a1 = broker.subscribe("aexec_a");
    const a2 = broker.subscribe("aexec_a");
    const b = broker.subscribe("aexec_b");

    broker.broadcast(frame("aexec_a"));

    expect(a1.queue).toHaveLength(1);
    expect(a2.queue).toHaveLength(1);
    expect(b.queue).toHaveLength(0);
    expect(broker.getSubscriberCount("aexec_a")).toBe(2);
  });

  it("wakes a parked consumer exactly once per push", () => {
    const { logger } = capturingLogger();
    const broker = new StreamBroker(logger);
    const sub = broker.subscribe("aexec_x");

    let woken = 0;
    sub.notify = () => {
      woken += 1;
    };
    broker.broadcast(frame("aexec_x"));

    expect(woken).toBe(1);
    // The broker clears the hook after firing (one-shot, like the
    // generator re-arms it per wait).
    expect(sub.notify).toBeUndefined();
  });

  it("drops the frame for a full subscriber and warns (never blocks)", () => {
    const { logger, lines } = capturingLogger();
    const broker = new StreamBroker(logger);
    const sub = broker.subscribe("aexec_full");

    for (let i = 0; i < SUBSCRIBER_BUFFER_CAPACITY; i++) {
      broker.broadcast(frame("aexec_full", `frame-${i}`));
    }
    expect(sub.queue).toHaveLength(SUBSCRIBER_BUFFER_CAPACITY);

    broker.broadcast(frame("aexec_full", "overflow"));
    expect(sub.queue).toHaveLength(SUBSCRIBER_BUFFER_CAPACITY);
    expect(sub.queue.at(-1)?.status?.error).toBe(
      `frame-${SUBSCRIBER_BUFFER_CAPACITY - 1}`,
    );
    expect(
      lines.some((l) => l.message.includes("Subscriber channel full")),
    ).toBe(true);
  });

  it("unsubscribe closes, wakes, cleans the map, and is idempotent", () => {
    const { logger } = capturingLogger();
    const broker = new StreamBroker(logger);
    const sub = broker.subscribe("aexec_gone");

    let woken = false;
    sub.notify = () => {
      woken = true;
    };
    broker.unsubscribe("aexec_gone", sub);

    expect(sub.closed).toBe(true);
    expect(woken, "a parked consumer observes the close").toBe(true);
    expect(broker.getSubscriberCount("aexec_gone")).toBe(0);

    // Idempotent; a post-close broadcast reaches nobody and throws nothing.
    broker.unsubscribe("aexec_gone", sub);
    broker.broadcast(frame("aexec_gone"));
    expect(sub.queue).toHaveLength(0);
  });

  it("ignores frames without a metadata id (Go's nil guard)", () => {
    const { logger } = capturingLogger();
    const broker = new StreamBroker(logger);
    const sub = broker.subscribe("");
    broker.broadcast(create(AgentExecutionSchema, {}));
    expect(sub.queue).toHaveLength(0);
  });
});
