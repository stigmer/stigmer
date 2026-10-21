/**
 * Pins the session event bell (../broker.ts) and the stream that reads the
 * log under it (../stream.ts): an append rings the streams of its session
 * and no other, previews reach only the streams that asked for their type
 * and are dropped (never the stream) when a reader falls behind, the stream
 * is a cursor over the stored log (exactly once and in order, whichever
 * process wrote the event, and a slow reader only lags), and a closing
 * broker ends every stream with UNAVAILABLE.
 */
import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import type { HandlerContext } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionEventSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import {
  SessionEventPreviewSchema,
  StreamSessionEventsRequestSchema,
  type SessionEventPreview,
  type StreamSessionEventsResponse,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";

import { createLogger } from "../../../../boot/logger.js";
import type { Store } from "../../../../store/interface.js";
import { tempStore } from "../../../../store/sqlite/__tests__/support.js";
import { testCallerIdentity } from "../../../../pipeline/__tests__/support.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../../pipeline/steps/authorize.js";
import {
  SESSION_EVENT_BROKER_CLOSED_MESSAGE,
  SESSION_EVENT_DROPPED_IDS_KEPT,
  SESSION_EVENT_PREVIEW_CAPACITY,
  SESSION_EVENT_PREVIEW_MAX_BYTES,
  SessionEventBroker,
} from "../broker.js";
import {
  SESSION_EVENT_REPLAY_BATCH,
  SESSION_EVENT_STREAM_REAUTHORIZE_MS,
  SESSION_EVENT_TAIL_MAX_MS,
  SESSION_EVENT_TAIL_MIN_MS,
  streamSessionEvents,
  type StreamSessionEventsDeps,
} from "../stream.js";
import { draftOf } from "../codec.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

function thinking(id: string, seq: number): SessionEvent {
  return create(SessionEventSchema, { seq: BigInt(seq), event: { case: "agentThinking", value: { id } } });
}

function delta(eventId: string, text: string): SessionEventPreview {
  return create(SessionEventPreviewSchema, {
    preview: { case: "eventDelta", value: { eventId, delta: { type: "content_delta", content: { type: "text", text } } } },
  });
}

function context(signal: AbortSignal): HandlerContext {
  const identity = testCallerIdentity();
  return { signal, values: { get: () => identity }, requestHeader: new Headers() } as unknown as HandlerContext;
}

function seqOf(frame: StreamSessionEventsResponse | undefined): bigint {
  return frame?.frame.case === "event" ? frame.frame.value.seq : -1n;
}

/** Lets the stream's generator run up to its next wait. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("the broker", () => {
  it("rings the streams of the appending session only, and copies no event", () => {
    const broker = new SessionEventBroker(silentLogger);
    const mine = broker.subscribe("s1", []);
    const other = broker.subscribe("s2", []);
    broker.publish("s1", [thinking("a", 1), thinking("b", 2)]);
    expect(mine.dirty).toBe(true);
    expect(mine.previews).toEqual([]);
    expect(other.dirty).toBe(false);
  });

  it("an append that added nothing rings no bell", () => {
    const broker = new SessionEventBroker(silentLogger);
    const mine = broker.subscribe("s1", []);
    broker.publish("s1", []);
    expect(mine.dirty).toBe(false);
  });

  it("previews reach the streams that asked for their type; a delta is part of an agent.message", () => {
    const broker = new SessionEventBroker(silentLogger);
    const none = broker.subscribe("s1", []);
    const messages = broker.subscribe("s1", ["agent.message"]);
    broker.publishPreviews("s1", [
      create(SessionEventPreviewSchema, { preview: { case: "eventStart", value: { event: { id: "t", type: "agent.thinking" } } } }),
      delta("m", "x"),
    ]);
    expect(none.previews).toEqual([]);
    expect(messages.previews.map((f) => f.frame.case)).toEqual(["eventDelta"]);
  });

  it("a running tool's output fragment reaches only the streams that asked for stigmer.tool_output_delta", () => {
    const broker = new SessionEventBroker(silentLogger);
    const messages = broker.subscribe("s1", ["agent.message"]);
    const output = broker.subscribe("s1", ["stigmer.tool_output_delta"]);
    broker.publishPreviews("s1", [
      create(SessionEventPreviewSchema, { preview: { case: "stigmerToolOutputDelta", value: { toolUseId: "u", delta: "12 passing" } } }),
    ]);
    expect(messages.previews).toEqual([]);
    expect(output.previews.map((f) => f.frame.case)).toEqual(["stigmerToolOutputDelta"]);
  });

  it("drops a slow stream's previews, never the stream, and skips the dropped messages' later fragments", () => {
    const broker = new SessionEventBroker(silentLogger);
    const slow = broker.subscribe("s1", ["agent.message"]);
    const fresh = broker.subscribe("s1", ["agent.message"]);
    broker.publishPreviews("s1", Array.from({ length: SESSION_EVENT_PREVIEW_CAPACITY }, () => delta("m1", "x")));
    while (broker.take(fresh) !== undefined) {
      // the fresh stream keeps up
    }
    broker.publishPreviews("s1", [delta("m2", "y")]);
    expect(slow.closed, "the stream stays open").toBe(false);
    expect(slow.previews).toEqual([]);
    expect(slow.queuedBytes).toBe(0);
    expect([...slow.droppedIds].sort()).toEqual(["m1", "m2"]);
    broker.publishPreviews("s1", [delta("m1", "z"), delta("m3", "w")]);
    expect(
      slow.previews.map((f) => (f.frame.case === "eventDelta" ? f.frame.value.eventId : "")),
      "a dropped message's later fragment never arrives; a new message's does",
    ).toEqual(["m3"]);
    expect(fresh.previews.map((f) => (f.frame.case === "eventDelta" ? f.frame.value.eventId : ""))).toEqual(["m2", "m1", "m3"]);
    expect(broker.subscriberCount("s1")).toBe(2);
  });

  it("drops previews past the byte budget before the frame cap", () => {
    const broker = new SessionEventBroker(silentLogger);
    const slow = broker.subscribe("s1", ["agent.message"]);
    const big = (i: number) => delta(`m${i}`, "x".repeat(1024 * 1024));
    for (let i = 1; i <= 31; i++) {
      broker.publishPreviews("s1", [big(i)]);
    }
    expect(slow.previews).toHaveLength(31);
    broker.publishPreviews("s1", [big(32), big(33)]);
    expect(slow.previews.map((f) => (f.frame.case === "eventDelta" ? f.frame.value.eventId : ""))).toEqual(["m33"]);
    expect(slow.droppedIds.has("m1") && slow.droppedIds.has("m32")).toBe(true);
    expect(SESSION_EVENT_PREVIEW_MAX_BYTES).toBe(32 * 1024 * 1024);
  });

  it("remembers a bounded number of dropped ids, forgetting the oldest", () => {
    const broker = new SessionEventBroker(silentLogger);
    const slow = broker.subscribe("s1", ["agent.message"]);
    const ids = SESSION_EVENT_DROPPED_IDS_KEPT + SESSION_EVENT_PREVIEW_CAPACITY;
    for (let i = 0; i <= ids; i++) {
      broker.publishPreviews("s1", [delta(`m${i}`, "x")]);
    }
    expect(slow.droppedIds.size).toBe(SESSION_EVENT_DROPPED_IDS_KEPT);
    expect(slow.droppedIds.has("m0")).toBe(false);
  });

  it("closing ends every stream with its reason and refuses new ones", () => {
    const broker = new SessionEventBroker(silentLogger);
    const open = broker.subscribe("s1", []);
    let woken = false;
    open.notify = () => (woken = true);
    broker.close();
    broker.close("ignored: already closed");
    expect(open.closed && woken).toBe(true);
    expect(open.closedBecause).toBe(SESSION_EVENT_BROKER_CLOSED_MESSAGE);
    expect(broker.subscriberCount("s1")).toBe(0);
    const late = broker.subscribe("s1", []);
    expect(late.closed).toBe(true);
    expect(late.closedBecause).toBe(SESSION_EVENT_BROKER_CLOSED_MESSAGE);
    broker.unsubscribe("s1", late);
  });
});

describe("the stream", () => {
  let temp: ReturnType<typeof tempStore>;
  const guard = { kind: ApiResourceKind.run, id: "run_r", schema: RunSchema, admit: () => undefined };

  beforeEach(async () => {
    temp = tempStore();
    await temp.store.saveResource(
      ApiResourceKind.run,
      "run_r",
      RunSchema,
      create(RunSchema, {
        metadata: { id: "run_r", org: "acme" },
        spec: { target: { case: "sessionId", value: "s1" } },
        status: { phase: RunPhase.RUN_IN_PROGRESS },
      }),
    );
  });

  afterEach(async () => {
    await temp.cleanup();
  });

  /** Appends to the log as any process would: committed, with no bell rung here. */
  async function commit(...ids: string[]): Promise<void> {
    await temp.store.sessionEvents.append("s1", "acme", ids.map((id) => draftOf(thinking(id, 0))), guard);
  }

  function open(
    broker: SessionEventBroker,
    request: { afterSeq?: bigint; eventDeltas?: string[] } = {},
    deps: Partial<StreamSessionEventsDeps> = {},
    signal: AbortSignal = new AbortController().signal,
  ) {
    return streamSessionEvents(
      {
        store: temp.store,
        logger: silentLogger,
        authorizer: newPermissiveSingleTeamAuthorizer(),
        sessionEventBroker: broker,
        ...deps,
      },
      create(StreamSessionEventsRequestSchema, { sessionId: "s1", ...request }),
      context(signal),
    );
  }

  it("starts after the newest stored event, sends what the bell rings for, and unsubscribes when the client leaves", async () => {
    await commit("old");
    const broker = new SessionEventBroker(silentLogger);
    const abort = new AbortController();
    const stream = open(broker, {}, {}, abort.signal);
    const first = stream.next();
    await settle();
    await commit("new");
    broker.publish("s1", [thinking("new", 2)]);
    expect(seqOf((await first).value), "nothing from before it opened").toBe(2n);
    abort.abort();
    expect((await stream.next()).done).toBe(true);
    expect(broker.subscriberCount("s1")).toBe(0);
  });

  it("resumes after a seq: the stored events after it, then later ones, none missing and none repeated", async () => {
    await commit("a", "b", "c");
    const broker = new SessionEventBroker(silentLogger);
    const stream = open(broker, { afterSeq: 1n });
    const seqs: bigint[] = [seqOf((await stream.next()).value)];
    // A bell rung while the stream reads: the event is either in this read or the next, never both.
    await commit("d");
    broker.publish("s1", [thinking("d", 4)]);
    for (let i = 0; i < 2; i++) {
      seqs.push(seqOf((await stream.next()).value));
    }
    expect(seqs).toEqual([2n, 3n, 4n]);
    await stream.return(undefined);
  });

  it("finds an event another process committed at the tail read, with no bell", async () => {
    const broker = new SessionEventBroker(silentLogger);
    const stream = open(broker, { afterSeq: 0n }, { tailMs: { min: 20, max: 40 } });
    const first = stream.next();
    await settle();
    await commit("elsewhere");
    expect(seqOf((await first).value)).toBe(1n);
    await stream.return(undefined);
  });

  it("backs its tail read off from the minimum to the maximum while nothing arrives", () => {
    expect(SESSION_EVENT_TAIL_MIN_MS).toBe(15_000);
    expect(SESSION_EVENT_TAIL_MAX_MS).toBe(2 * 60_000);
  });

  it("a slow reader only lags: thousands of events committed while it is not reading arrive once each, in order", async () => {
    const broker = new SessionEventBroker(silentLogger);
    const stream = open(broker, { afterSeq: 0n });
    const total = 5 * SESSION_EVENT_REPLAY_BATCH + 7;
    const first = stream.next();
    await settle();
    for (let i = 0; i < total; i += 50) {
      await commit(...Array.from({ length: Math.min(50, total - i) }, (_, j) => `e${i + j}`));
      broker.publish("s1", [thinking("ring", 0)]);
    }
    const seqs: bigint[] = [seqOf((await first).value)];
    while (seqs.length < total) {
      seqs.push(seqOf((await stream.next()).value));
    }
    expect(seqs).toEqual(Array.from({ length: total }, (_, i) => BigInt(i + 1)));
    expect(broker.subscriberCount("s1"), "never ended").toBe(1);
    await stream.return(undefined);
  });

  it("sends an append's previews before its events", async () => {
    const broker = new SessionEventBroker(silentLogger);
    const stream = open(broker, { eventDeltas: ["agent.message"] });
    const first = stream.next();
    await settle();
    await commit("m");
    broker.publishPreviews("s1", [delta("m", "he")]);
    broker.publish("s1", [thinking("m", 1)]);
    expect((await first).value?.frame.case).toBe("eventDelta");
    expect(seqOf((await stream.next()).value)).toBe(1n);
    await stream.return(undefined);
  });

  it("ends with UNAVAILABLE when the broker closes, and refuses a stream opened after", async () => {
    const broker = new SessionEventBroker(silentLogger);
    const stream = open(broker, { afterSeq: 0n });
    const first = stream.next();
    await settle();
    broker.close();
    await expect(first).rejects.toMatchObject({ code: Code.Unavailable });
    expect(broker.subscriberCount("s1")).toBe(0);
    await expect(open(broker, { afterSeq: 0n }).next()).rejects.toMatchObject({
      code: Code.Unavailable,
      rawMessage: SESSION_EVENT_BROKER_CLOSED_MESSAGE,
    });
  });

  it("asks the method's question again once the stream has served long enough, and ends when it is refused", async () => {
    const broker = new SessionEventBroker(silentLogger);
    let clock = 0;
    let asked = 0;
    const authorizer = {
      authorize: async () => {
        asked += 1;
        return asked <= 2 ? { kind: "allow" as const } : { kind: "deny" as const, reason: "revoked" };
      },
    } as unknown as StreamSessionEventsDeps["authorizer"];
    const stream = open(broker, { afterSeq: 0n }, { authorizer, now: () => clock });
    const ring = async (id: string) => {
      await commit(id);
      broker.publish("s1", [thinking(id, 0)]);
    };
    const first = stream.next();
    await settle();
    await ring("a");
    expect((await first).value?.frame.case).toBe("event");
    clock = SESSION_EVENT_STREAM_REAUTHORIZE_MS;
    const second = stream.next();
    await settle();
    await ring("b");
    expect((await second).value?.frame.case, "still allowed: the frame flows").toBe("event");
    clock = 2 * SESSION_EVENT_STREAM_REAUTHORIZE_MS;
    const third = stream.next();
    await settle();
    await ring("c");
    await expect(third).rejects.toMatchObject({ code: Code.PermissionDenied });
    expect(asked).toBe(3);
    expect(broker.subscriberCount("s1")).toBe(0);
  });

  it("answers a store fault as INTERNAL", async () => {
    const broker = new SessionEventBroker(silentLogger);
    const failing = { sessionEvents: { list: () => Promise.reject(new Error("database is locked")) } } as unknown as Store;
    await expect(open(broker, { afterSeq: 0n }, { store: failing }).next()).rejects.toMatchObject({ code: Code.Internal });
    await expect(open(broker, {}, { store: failing }).next()).rejects.toMatchObject({ code: Code.Internal });
    expect(broker.subscriberCount("s1")).toBe(0);
  });

  it("refuses a request that names no session", async () => {
    const broker = new SessionEventBroker(silentLogger);
    const stream = streamSessionEvents(
      { store: temp.store, logger: silentLogger, authorizer: newPermissiveSingleTeamAuthorizer(), sessionEventBroker: broker },
      create(StreamSessionEventsRequestSchema, {}),
      context(new AbortController().signal),
    );
    await expect(stream.next()).rejects.toMatchObject({ code: Code.InvalidArgument });
  });
});
