/**
 * Pins the session event fan-out (../broker.ts) and the stream that drains
 * it (../stream.ts): events reach every stream of their session and no
 * other, previews only the streams that asked for their type, and a stream
 * that falls behind is ENDED with RESOURCE_EXHAUSTED rather than silently
 * missing events, the one rule where it differs from the run snapshot
 * broker.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import type { HandlerContext } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { SessionEventSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import {
  SessionEventPreviewSchema,
  StreamSessionEventsRequestSchema,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";

import { createLogger } from "../../../../boot/logger.js";
import { testCallerIdentity } from "../../../../pipeline/__tests__/support.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../../pipeline/steps/authorize.js";
import {
  SESSION_EVENT_SUBSCRIBER_CAPACITY,
  SESSION_EVENT_SUBSCRIBER_MAX_BYTES,
  SessionEventBroker,
} from "../broker.js";
import {
  SESSION_EVENT_STREAM_REAUTHORIZE_MS,
  STREAM_FELL_BEHIND_MESSAGE,
  streamSessionEvents,
} from "../stream.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

function thinking(id: string, seq: number): SessionEvent {
  return create(SessionEventSchema, { seq: BigInt(seq), event: { case: "agentThinking", value: { id } } });
}

function context(signal: AbortSignal): HandlerContext {
  const identity = testCallerIdentity();
  return { signal, values: { get: () => identity }, requestHeader: new Headers() } as unknown as HandlerContext;
}

describe("the broker", () => {
  it("delivers a session's events to its streams only, in order", () => {
    const broker = new SessionEventBroker(silentLogger);
    const mine = broker.subscribe("s1", []);
    const other = broker.subscribe("s2", []);
    broker.publish("s1", [thinking("a", 1), thinking("b", 2)]);
    expect(mine.queue.map((f) => (f.frame.case === "event" ? f.frame.value.seq : 0n))).toEqual([1n, 2n]);
    expect(other.queue).toEqual([]);
  });

  it("previews reach the streams that asked for their type; a delta is part of an agent.message", () => {
    const broker = new SessionEventBroker(silentLogger);
    const none = broker.subscribe("s1", []);
    const messages = broker.subscribe("s1", ["agent.message"]);
    broker.publishPreviews("s1", [
      create(SessionEventPreviewSchema, { preview: { case: "eventStart", value: { event: { id: "t", type: "agent.thinking" } } } }),
      create(SessionEventPreviewSchema, {
        preview: { case: "eventDelta", value: { eventId: "m", delta: { type: "content_delta", content: { type: "text", text: "x" } } } },
      }),
    ]);
    expect(none.queue).toEqual([]);
    expect(messages.queue.map((f) => f.frame.case)).toEqual(["eventDelta"]);
  });

  it("ends a stream whose undelivered bytes pass the budget, before the frame cap", () => {
    const broker = new SessionEventBroker(silentLogger);
    const slow = broker.subscribe("s1", []);
    const big = (i: number) =>
      create(SessionEventSchema, {
        seq: BigInt(i),
        event: { case: "agentMessage", value: { id: `m${i}`, content: [{ type: "text", text: "x".repeat(1024 * 1024) }] } },
      });
    for (let i = 1; i <= 31; i++) {
      broker.publish("s1", [big(i)]);
    }
    expect(slow.overflowed).toBe(false);
    expect(slow.queue.length).toBeLessThan(SESSION_EVENT_SUBSCRIBER_CAPACITY);
    broker.publish("s1", [big(32), big(33)]);
    expect(slow.overflowed).toBe(true);
    expect(slow.queuedBytes).toBe(0);
    expect(SESSION_EVENT_SUBSCRIBER_MAX_BYTES).toBe(32 * 1024 * 1024);
  });

  it("ends a stream that falls behind instead of thinning it, and keeps serving the others", () => {
    const broker = new SessionEventBroker(silentLogger);
    const slow = broker.subscribe("s1", []);
    broker.publish("s1", Array.from({ length: SESSION_EVENT_SUBSCRIBER_CAPACITY }, (_, i) => thinking(`e${i}`, i + 1)));
    const fresh = broker.subscribe("s1", []);
    broker.publish("s1", [thinking("over", SESSION_EVENT_SUBSCRIBER_CAPACITY + 1)]);
    expect(slow.overflowed).toBe(true);
    expect(slow.closed).toBe(true);
    expect(slow.queue).toEqual([]);
    expect(fresh.queue).toHaveLength(1);
    expect(broker.subscriberCount("s1")).toBe(1);
  });
});

describe("the stream", () => {
  it("yields what the broker delivers and unsubscribes when the client leaves", async () => {
    const broker = new SessionEventBroker(silentLogger);
    const abort = new AbortController();
    const stream = streamSessionEvents(
      { logger: silentLogger, authorizer: newPermissiveSingleTeamAuthorizer(), sessionEventBroker: broker },
      create(StreamSessionEventsRequestSchema, { sessionId: "s1" }),
      context(abort.signal),
    );
    const first = stream.next();
    await new Promise((resolve) => setImmediate(resolve));
    broker.publish("s1", [thinking("a", 1)]);
    const frame = (await first).value;
    expect(frame?.frame.case).toBe("event");
    abort.abort();
    expect((await stream.next()).done).toBe(true);
    expect(broker.subscriberCount("s1")).toBe(0);
  });

  it("ends with RESOURCE_EXHAUSTED when it fell behind, telling the client to list from its last event", async () => {
    const broker = new SessionEventBroker(silentLogger);
    const stream = streamSessionEvents(
      { logger: silentLogger, authorizer: newPermissiveSingleTeamAuthorizer(), sessionEventBroker: broker },
      create(StreamSessionEventsRequestSchema, { sessionId: "s1" }),
      context(new AbortController().signal),
    );
    const first = stream.next();
    await new Promise((resolve) => setImmediate(resolve));
    broker.publish("s1", Array.from({ length: SESSION_EVENT_SUBSCRIBER_CAPACITY + 1 }, (_, i) => thinking(`e${i}`, i + 1)));
    const error = await first.then(
      () => undefined,
      (e: unknown) => ConnectError.from(e),
    );
    expect(error?.code).toBe(Code.ResourceExhausted);
    expect(error?.rawMessage).toBe(STREAM_FELL_BEHIND_MESSAGE);
  });

  it("asks the method's question again once the stream has served long enough, and ends when it is refused", async () => {
    const broker = new SessionEventBroker(silentLogger);
    let clock = 0;
    let asked = 0;
    const authorizer = {
      authorize: async () => {
        asked += 1;
        return asked === 1 ? { kind: "allow" as const } : { kind: "deny" as const, reason: "revoked" };
      },
    } as unknown as Parameters<typeof streamSessionEvents>[0]["authorizer"];
    const stream = streamSessionEvents(
      { logger: silentLogger, authorizer, sessionEventBroker: broker, now: () => clock },
      create(StreamSessionEventsRequestSchema, { sessionId: "s1" }),
      context(new AbortController().signal),
    );
    const first = stream.next();
    await new Promise((resolve) => setImmediate(resolve));
    broker.publish("s1", [thinking("a", 1)]);
    expect((await first).value?.frame.case).toBe("event");
    clock = SESSION_EVENT_STREAM_REAUTHORIZE_MS;
    const second = stream.next();
    await new Promise((resolve) => setImmediate(resolve));
    broker.publish("s1", [thinking("b", 2)]);
    await expect(second).rejects.toMatchObject({ code: Code.PermissionDenied });
    expect(asked).toBe(2);
    expect(broker.subscriberCount("s1")).toBe(0);
  });

  it("refuses a request that names no session", async () => {
    const broker = new SessionEventBroker(silentLogger);
    const stream = streamSessionEvents(
      { logger: silentLogger, authorizer: newPermissiveSingleTeamAuthorizer(), sessionEventBroker: broker },
      create(StreamSessionEventsRequestSchema, {}),
      context(new AbortController().signal),
    );
    await expect(stream.next()).rejects.toMatchObject({ code: Code.InvalidArgument });
  });
});
