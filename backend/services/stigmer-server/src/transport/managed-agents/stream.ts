/**
 * `GET /v1/sessions/{id}/events/stream`: a session's events as they are
 * appended, as server-sent events Anthropic's SDK reads.
 *
 * No gap at open. The native stream registers for live events only once
 * its generator runs, so headers written before that would leave a window
 * in which an event appended right after the client's `stream()` resolved
 * is never sent, and "open the stream, then send" is the order Managed
 * Agents documents. So the lane first reads the session's newest event
 * (which also turns an unknown session, an outsider or a bad key into a
 * plain HTTP error before any stream exists), then opens the native stream
 * resuming after that event's seq, and writes the headers at once. Every
 * event appended after the read is replayed from the store once the
 * subscription registers, however the two race; the client sees "events
 * from the moment it opened", without the window. The lane does not wait
 * for a first frame: a quiet session would hold `stream()` open. An empty
 * log asks the session itself, so an unknown session is a 404 before any
 * stream exists (list.ts says why).
 *
 * Each frame is `event: <type>` then `data: <json>`: the SDK yields a frame
 * only when its event name is a Managed Agents type it lists, so the name
 * is the JSON's own `type`. Stigmer's own events and its tool-output
 * preview are skipped. A `: keep-alive` comment every interval keeps idle
 * proxies from closing a quiet stream; the SDK ignores comments.
 *
 * Back-pressure: when a write is buffered, the next frame waits for
 * `drain`, so a slow reader backs up into the native stream, whose bound
 * ends it with RESOURCE_EXHAUSTED; the lane buffers nothing of its own.
 * The client closing aborts the native call. A native error is written as
 * an `event: error` frame carrying Anthropic's envelope, which the SDK
 * throws as an APIError, and the body ends. Reconnecting is the client's
 * list-then-stream, as Managed Agents documents.
 *
 * Proven by __tests__/stream.test.ts and the session-events-managed-agents
 * execution conformance suite.
 */
import type { EventEmitter } from "node:events";

import { create } from "@bufbuild/protobuf";
import type { JsonObject } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import {
  ListSessionEventsRequestSchema,
  StreamSessionEventsRequestSchema,
  type StreamSessionEventsResponse,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { eventTypeOf, isStigmerEventType, toManagedAgentsJson, toManagedAgentsStreamJson } from "@stigmer/session-log";

import { KEEPALIVE_PING_INTERVAL_MS } from "../constants.js";
import type { LaneResponse } from "../lanes.js";
import type { LaneCall } from "./call.js";
import { errorEnvelope, laneError, laneErrorOf, type LaneError } from "./errors.js";
import { requireSession } from "./list.js";
import type { StreamQuery } from "./query.js";
import { REQUEST_ID_HEADER } from "./respond.js";

/** The keep-alive interval: the unified port's own h2 ping interval. */
export const STREAM_KEEPALIVE_MS = KEEPALIVE_PING_INTERVAL_MS;

/** What a stream that fell behind tells the client to do. */
export const STREAM_FELL_BEHIND_MESSAGE =
  "the event stream fell behind; list the events since the last one received, then stream again";

/** Opens the stream; a refusal before the headers throws for the lane to write. */
export async function serveStream(
  call: LaneCall,
  query: StreamQuery,
  response: LaneResponse,
  keepAliveMs: number = STREAM_KEEPALIVE_MS,
): Promise<number> {
  const newest = await call.clients.sessionQuery.listEvents(
    create(ListSessionEventsRequestSchema, { sessionId: call.sessionId, order: "desc", pageSize: 1 }),
    call.options,
  );
  if (newest.events.length === 0) {
    await requireSession(call);
  }
  const frames = call.clients.sessionQuery.streamEvents(
    create(StreamSessionEventsRequestSchema, {
      sessionId: call.sessionId,
      eventDeltas: [...query.eventDeltas],
      afterSeq: newest.events[0]?.seq ?? 0n,
    }),
    call.options,
  );

  response.statusCode = 200;
  response.setHeader("Content-Type", "text/event-stream");
  response.setHeader("Cache-Control", "no-cache");
  response.setHeader(REQUEST_ID_HEADER, call.requestId);
  const writer = new SseWriter(response, call.options.signal);
  // The first comment sends the headers, so the client's stream() resolves now.
  writer.comment("open");
  const keepAlive = setInterval(() => writer.comment("keep-alive"), keepAliveMs);
  keepAlive.unref();
  try {
    for await (const frame of frames) {
      const json = laneFrameJson(frame);
      if (json !== undefined) {
        await writer.frame(String(json["type"]), JSON.stringify(json));
      }
    }
  } catch (error) {
    if (!call.options.signal.aborted) {
      writer.frameNow("error", errorEnvelope(streamErrorOf(error), call.requestId));
    }
  } finally {
    clearInterval(keepAlive);
    response.end();
  }
  return 200;
}

/** A native frame as the lane sends it, or undefined for a frame only Stigmer's API carries. */
export function laneFrameJson(frame: StreamSessionEventsResponse): JsonObject | undefined {
  switch (frame.frame.case) {
    case "event":
      return isStigmerEventType(eventTypeOf(frame.frame.value)) ? undefined : toManagedAgentsJson(frame.frame.value);
    case "eventStart":
    case "eventDelta":
      return toManagedAgentsStreamJson(frame);
    case "stigmerToolOutputDelta":
    case undefined:
      return undefined;
    default: {
      const exhaustive: never = frame.frame;
      return exhaustive;
    }
  }
}

/** A native stream's failure as the error frame's error. */
export function streamErrorOf(error: unknown): LaneError {
  if (error instanceof ConnectError && error.code === Code.ResourceExhausted) {
    return laneError(503, "overloaded_error", STREAM_FELL_BEHIND_MESSAGE);
  }
  return laneErrorOf(error);
}

/** Server-sent events over either protocol stack, honouring write back-pressure. */
class SseWriter {
  private draining = false;
  /** The one write signature both protocol stacks' responses share. */
  private readonly body: { write(chunk: string): boolean };

  constructor(
    private readonly response: LaneResponse,
    private readonly closed: AbortSignal,
  ) {
    this.body = response;
  }

  /** A comment line; skipped while a frame waits for the buffer to drain. */
  comment(text: string): void {
    if (!this.draining && !this.gone()) {
      this.body.write(`: ${text}\n\n`);
    }
  }

  /** One event frame; resolves once the response can take the next. */
  async frame(event: string, data: string): Promise<void> {
    if (this.frameNow(event, data)) {
      return;
    }
    this.draining = true;
    const emitter: EventEmitter = this.response;
    await new Promise<void>((resolve) => {
      const done = (): void => {
        emitter.off("drain", done);
        emitter.off("close", done);
        resolve();
      };
      emitter.on("drain", done);
      emitter.on("close", done);
    });
    this.draining = false;
  }

  /** Writes one frame; false when the response buffered it. */
  frameNow(event: string, data: string): boolean {
    if (this.gone()) {
      return true;
    }
    return this.body.write(`event: ${event}\ndata: ${data}\n\n`);
  }

  /** Whether the client left or the body already ended. */
  private gone(): boolean {
    return this.closed.aborted || this.response.writableEnded;
  }
}
