// Unit arms for the turn watcher, over an in-process async iterable of the
// session's stream frames (turn-events.ts) and a scripted clock.
// Domain: conformance benchmark.
//
// Pinned: the first-visible and first-text stamps are taken at the arrival
// of the first frame that shows them and never move, a live preview
// included; the review stamp is the arrival of the turn's offer, and the
// watch goes on to the turn's end; the end-to-end stamp is the arrival of
// the turn's end; every axis is relative to the create call's start; another
// turn's events stamp nothing; a stream that never ends the turn reports a
// timeout with a null end-to-end and keeps what it did see. The default
// stream reads the session's whole log, then its live events, with message
// and thinking previews.
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import {
  StreamSessionEventsResponseSchema,
  type StreamSessionEventsResponse,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { describe, expect, it, vi } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import { streamSessionEvents, watchTurn } from "../stream-watch";
import { RUN, offered, phase, said, thought, userMessage } from "./turn-events";

type FrameInit = MessageInitShape<typeof StreamSessionEventsResponseSchema>["frame"];

function stored(event: SessionEvent): StreamSessionEventsResponse {
  return create(StreamSessionEventsResponseSchema, { frame: { case: "event", value: event } });
}

function preview(frame: FrameInit): StreamSessionEventsResponse {
  return create(StreamSessionEventsResponseSchema, { frame });
}

function scripted(frames: StreamSessionEventsResponse[]): (signal: AbortSignal) => AsyncIterable<StreamSessionEventsResponse> {
  return () => ({
    async *[Symbol.asyncIterator]() {
      for (const item of frames) yield item;
    },
  });
}

describe("watchTurn", () => {
  it("stamps first-visible on the thinking, first-text on the message, and end-to-end on the turn's end", async () => {
    const [thinking, thinkingText] = thought(0, "hmm");
    const frames = [
      stored(userMessage("hi")),
      stored(thinking!),
      stored(thinkingText!),
      stored(said(0, "Hello.")),
      stored(phase("completed")),
    ];
    const clock = [1000, 1400, 1500, 2100, 3000];
    let tick = 0;
    const watched = await watchTurn(scripted(frames), RUN, {
      startedAtMs: 500,
      timeoutMs: 10_000,
      now: () => clock[tick++] ?? 9999,
    });
    expect(watched.client_first_visible_token_ms).toBe(900);
    expect(watched.client_first_text_ms).toBe(1600);
    expect(watched.end_to_end_ms).toBe(2500);
    expect(watched.review_ready_ms).toBeNull();
    expect(watched.outcome).toBe("until");
    expect(watched.turn?.status?.phase).toBe("completed");
  });

  it("counts a live message preview as the first text", async () => {
    const frames = [
      stored(userMessage("hi")),
      preview({ case: "eventStart", value: { event: { id: `${RUN}.root.m0`, type: "agent.message" } } }),
      preview({
        case: "eventDelta",
        value: { eventId: `${RUN}.root.m0`, delta: { type: "content_delta", index: 0, content: { type: "text", text: "Hel" } } },
      }),
      stored(said(0, "Hello.")),
      stored(phase("completed")),
    ];
    const clock = [1000, 1200, 1300, 1900, 2000];
    let tick = 0;
    const watched = await watchTurn(scripted(frames), RUN, {
      startedAtMs: 500,
      timeoutMs: 10_000,
      now: () => clock[tick++] ?? 9999,
    });
    expect(watched.client_first_text_ms).toBe(800);
    expect(watched.end_to_end_ms).toBe(1500);
  });

  it("stamps the review offer and follows the turn to its end", async () => {
    const frames = [stored(userMessage("edit")), stored(said(0, "Editing.")), stored(offered(`${RUN}:1`)), stored(phase("completed"))];
    const clock = [1000, 1400, 1800, 2600];
    let tick = 0;
    const watched = await watchTurn(scripted(frames), RUN, {
      startedAtMs: 500,
      timeoutMs: 10_000,
      now: () => clock[tick++] ?? 9999,
    });
    expect(watched.review_ready_ms).toBe(1300);
    expect(watched.end_to_end_ms).toBe(2100);
    expect(watched.turn?.fileReview.map((set) => set.changeSetId)).toEqual([`${RUN}:1`]);
  });

  it("a stream that never ends the turn is a timeout with a null end-to-end and the stamps it did take", async () => {
    // Honours the abort the bounded reader sends, the way a Connect stream
    // does: the iterable ends with Canceled once the deadline passes.
    const forever = (signal: AbortSignal): AsyncIterable<StreamSessionEventsResponse> => ({
      async *[Symbol.asyncIterator]() {
        yield stored(userMessage("hi"));
        yield stored(said(0, "Hel"));
        await new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => reject(new ConnectError("aborted", Code.Canceled)), { once: true });
        });
      },
    });
    const watched = await watchTurn(forever, RUN, { startedAtMs: 0, timeoutMs: 50, now: () => 20 });
    expect(watched.outcome).toBe("timeout");
    expect(watched.end_to_end_ms).toBeNull();
    expect(watched.client_first_text_ms).toBe(20);
  });

  it("stamps nothing for a turn of another run", async () => {
    const watched = await watchTurn(scripted([stored(userMessage("hi")), stored(said(0, "Hello."))]), "run_other", {
      startedAtMs: 0,
      timeoutMs: 50,
      now: () => 20,
    });
    expect(watched.turn).toBeUndefined();
    expect(watched.client_first_visible_token_ms).toBeNull();
    expect(watched.outcome).toBe("closed");
  });
});

describe("streamSessionEvents", () => {
  it("opens the session's stream from the start of its log with message and thinking previews", () => {
    const frames = scripted([])(new AbortController().signal);
    const streamEvents = vi.fn(() => frames);
    const clients = { sessionQuery: { streamEvents } } as unknown as ConformanceClients;
    const signal = new AbortController().signal;
    expect(streamSessionEvents(clients, "ses_1")(signal)).toBe(frames);
    expect(streamEvents).toHaveBeenCalledWith(
      { sessionId: "ses_1", afterSeq: 0n, eventDeltas: ["agent.message", "agent.thinking"] },
      { signal },
    );
  });
});
