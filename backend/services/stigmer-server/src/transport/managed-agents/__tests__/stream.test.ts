/**
 * The lane's server-sent events writer over a fake response and fake
 * native clients: the stream resumes after the newest event the lane read
 * (the open-window fix; the composed test proves the window itself), frames
 * are named by their Managed Agents type with Stigmer's own skipped, a
 * buffered write holds the next frame until `drain`, the keep-alive
 * comment, the error frame a native failure ends with, and silence once the
 * client has left.
 */
import { EventEmitter } from "node:events";

import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionEventSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import {
  SessionEventListSchema,
  StreamSessionEventsResponseSchema,
  type ListSessionEventsRequest,
  type StreamSessionEventsRequest,
  type StreamSessionEventsResponse,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";

import type { LaneResponse } from "../../lanes.js";
import type { LaneCall, LaneClients } from "../call.js";
import { serveStream, STREAM_FELL_BEHIND_MESSAGE } from "../stream.js";

/** A response that records what was written and buffers when told to. */
class FakeResponse extends EventEmitter {
  statusCode = 0;
  readonly headers = new Map<string, string>();
  readonly writes: string[] = [];
  writableEnded = false;
  /** What the next writes return; false models a full buffer. */
  accepting = true;

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  write(chunk: string): boolean {
    this.writes.push(chunk);
    return this.accepting;
  }

  end(): void {
    this.writableEnded = true;
  }

  frames(): Array<{ event: string; data: Record<string, unknown> }> {
    return this.writes
      .filter((chunk) => chunk.startsWith("event: "))
      .map((chunk) => {
        const [eventLine = "", dataLine = ""] = chunk.split("\n");
        return {
          event: eventLine.slice("event: ".length),
          data: JSON.parse(dataLine.slice("data: ".length)) as Record<string, unknown>,
        };
      });
  }
}

/** A frame source the test feeds one frame, or one failure, at a time. */
class FrameSource implements AsyncIterable<StreamSessionEventsResponse> {
  private readonly queue: Array<StreamSessionEventsResponse | Error> = [];
  private wake: (() => void) | undefined;
  /** How many frames the consumer has taken. */
  taken = 0;

  push(item: StreamSessionEventsResponse | Error): void {
    this.queue.push(item);
    this.wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<StreamSessionEventsResponse> {
    for (;;) {
      const next = this.queue.shift();
      if (next === undefined) {
        await new Promise<void>((resolve) => (this.wake = resolve));
        continue;
      }
      if (next instanceof Error) {
        throw next;
      }
      this.taken += 1;
      yield next;
    }
  }
}

const eventFrame = (frame: MessageInitShape<typeof StreamSessionEventsResponseSchema>["frame"]): StreamSessionEventsResponse =>
  create(StreamSessionEventsResponseSchema, { frame });

const userMessage = (seq: number): StreamSessionEventsResponse =>
  eventFrame({
    case: "event",
    value: create(SessionEventSchema, {
      seq: BigInt(seq),
      event: { case: "userMessage", value: { id: `sevt_${seq}`, content: [{ type: "text", text: "hi" }] } },
    }),
  });

function harness(newestSeq: bigint | undefined) {
  const source = new FrameSource();
  const abort = new AbortController();
  const seen: { list?: ListSessionEventsRequest; stream?: StreamSessionEventsRequest } = {};
  const sessionQuery = {
    listEvents: (request: ListSessionEventsRequest) => {
      seen.list = request;
      return Promise.resolve(
        create(SessionEventListSchema, {
          events:
            newestSeq === undefined
              ? []
              : [create(SessionEventSchema, { seq: newestSeq, event: { case: "userInterrupt", value: { id: "x" } } })],
        }),
      );
    },
    get: () => Promise.resolve(create(SessionSchema, {})),
    streamEvents: (request: StreamSessionEventsRequest) => {
      seen.stream = request;
      return source;
    },
  };
  const call: LaneCall = {
    sessionId: "ses_1",
    clients: { sessionQuery } as unknown as LaneClients,
    options: { headers: new Headers(), signal: abort.signal },
    requestId: "req_test",
  };
  const response = new FakeResponse();
  return { source, abort, seen, call, response, lane: response as unknown as LaneResponse };
}

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("serveStream", () => {
  it("reads the newest event, resumes after it, and sends the headers at once", async () => {
    const { seen, call, lane, response, source } = harness(7n);
    const served = serveStream(call, { eventDeltas: ["agent.message"] }, lane);
    await tick();
    expect(seen.list).toMatchObject({ sessionId: "ses_1", order: "desc", pageSize: 1 });
    expect(seen.stream).toMatchObject({ sessionId: "ses_1", afterSeq: 7n, eventDeltas: ["agent.message"] });
    expect(response.statusCode).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("request-id")).toBe("req_test");
    expect(response.writes[0]).toBe(": open\n\n");
    source.push(new ConnectError("done", Code.Canceled));
    await served;
  });

  it("resumes from the start of an empty log", async () => {
    const { seen, call, lane, source } = harness(undefined);
    const served = serveStream(call, { eventDeltas: [] }, lane);
    await tick();
    expect(seen.stream?.afterSeq).toBe(0n);
    source.push(new ConnectError("done", Code.Canceled));
    await served;
  });

  it("names each frame by its Managed Agents type and skips Stigmer's own", async () => {
    const { abort, call, lane, response, source } = harness(undefined);
    const served = serveStream(call, { eventDeltas: [] }, lane);
    source.push(userMessage(1));
    source.push(
      eventFrame({
        case: "event",
        value: create(SessionEventSchema, {
          seq: 2n,
          event: { case: "stigmerPermissionAsked", value: { id: "sevt_2", toolUseId: "tu_1" } },
        }),
      }),
    );
    source.push(eventFrame({ case: "stigmerToolOutputDelta", value: { toolUseId: "tu_1", delta: "out" } }));
    source.push(eventFrame({ case: "eventStart", value: { event: { id: "sevt_3", type: "agent.message" } } }));
    source.push(
      eventFrame({
        case: "eventDelta",
        value: { eventId: "sevt_3", delta: { type: "content_delta", content: { type: "text", text: "he" } } },
      }),
    );
    await tick(5);
    abort.abort();
    source.push(new ConnectError("the client left", Code.Canceled));
    await served;
    expect(response.frames().map((frame) => [frame.event, frame.data["type"]])).toEqual([
      ["user.message", "user.message"],
      ["event_start", "event_start"],
      ["event_delta", "event_delta"],
    ]);
    expect(response.frames()[0]?.data).toMatchObject({ id: "sevt_1", content: [{ type: "text", text: "hi" }] });
  });

  it("holds the next frame until a buffered write drains", async () => {
    const { call, lane, response, source } = harness(undefined);
    const served = serveStream(call, { eventDeltas: [] }, lane);
    await tick();
    response.accepting = false;
    source.push(userMessage(1));
    source.push(userMessage(2));
    await tick(5);
    expect(response.frames().map((frame) => frame.data["id"])).toEqual(["sevt_1"]);
    expect(source.taken).toBe(1);
    response.accepting = true;
    response.emit("drain");
    await tick(5);
    expect(response.frames().map((frame) => frame.data["id"])).toEqual(["sevt_1", "sevt_2"]);
    source.push(new ConnectError("done", Code.Canceled));
    await served;
  });

  it("sends a keep-alive comment on a quiet stream, and none while a frame waits to drain", async () => {
    const { call, lane, response, source } = harness(undefined);
    const served = serveStream(call, { eventDeltas: [] }, lane, 5);
    await tick(30);
    expect(response.writes.filter((chunk) => chunk === ": keep-alive\n\n").length).toBeGreaterThan(0);
    response.accepting = false;
    source.push(userMessage(1));
    await tick(5);
    const before = response.writes.length;
    await tick(30);
    expect(response.writes.length).toBe(before);
    response.accepting = true;
    response.emit("drain");
    source.push(new ConnectError("done", Code.Canceled));
    await served;
  });

  it("ends with an error frame in Anthropic's envelope when the native stream fails", async () => {
    for (const [failure, type, message] of [
      [new ConnectError("too slow", Code.ResourceExhausted), "overloaded_error", STREAM_FELL_BEHIND_MESSAGE],
      [new ConnectError("unauthorized to view session", Code.PermissionDenied), "permission_error", "unauthorized to view session"],
      [new Error("disk on fire"), "api_error", "internal server error"],
    ] as const) {
      const { call, lane, response, source } = harness(undefined);
      const served = serveStream(call, { eventDeltas: [] }, lane);
      source.push(failure);
      await served;
      expect(response.frames()).toEqual([
        { event: "error", data: { type: "error", error: { type, message }, request_id: "req_test" } },
      ]);
      expect(response.writableEnded).toBe(true);
    }
  });

  it("writes nothing more once the client has left", async () => {
    const { abort, call, lane, response, source } = harness(undefined);
    const served = serveStream(call, { eventDeltas: [] }, lane);
    await tick();
    abort.abort();
    source.push(userMessage(1));
    source.push(new ConnectError("aborted", Code.Canceled));
    await served;
    expect(response.frames()).toEqual([]);
    expect(response.writableEnded).toBe(true);
  });

  it("refuses before any header when the newest-event read is refused", async () => {
    const { call, lane, response } = harness(undefined);
    const refusing: LaneCall = {
      ...call,
      clients: {
        sessionQuery: { listEvents: () => Promise.reject(new ConnectError("session not found", Code.NotFound)) },
      } as unknown as LaneClients,
    };
    await expect(serveStream(refusing, { eventDeltas: [] }, lane)).rejects.toThrow("session not found");
    expect(response.writes).toEqual([]);
    expect(response.statusCode).toBe(0);
  });
});
