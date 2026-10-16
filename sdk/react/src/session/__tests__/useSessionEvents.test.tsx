/**
 * Proves useSessionEvents (../useSessionEvents.ts): one follow of the
 * session's log (all previews, from the start) whose frames are folded and
 * published once per animation frame; a dropped stream reconnects with
 * backoff from the newest event folded, showing `isReconnecting` and
 * streaming again on the next frame; the reconnects allowed (or none, with
 * `autoReconnect: false`) running out is an error, as is a refusal; a silent
 * follow is reconnected once, then `connectTimedOut` is surfaced until a
 * manual `reconnect`; a null id follows nothing; another session starts
 * from an empty fold; `isSlow` only while the newest turn works; unmounting
 * mid-reconnect ends the follow.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { ALL_SESSION_PREVIEWS, StigmerError, type Stigmer } from "@stigmer/client";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import type {
  StreamSessionEventsRequest,
  StreamSessionEventsResponse,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { StigmerContext } from "../../context";
import { ConversationStore } from "../../internal/store/index";
import { samples } from "../../test/samples";
import { useSessionEvents, type UseSessionEventsOptions } from "../useSessionEvents";

// ---------------------------------------------------------------------------
// A controllable session.streamEvents: every call opens a stream the test
// feeds frames into, ends (a drop), or fails.
// ---------------------------------------------------------------------------

type Item =
  | { readonly kind: "frame"; readonly frame: StreamSessionEventsResponse }
  | { readonly kind: "end" }
  | { readonly kind: "fail"; readonly error: Error };

class FakeStream {
  private queue: Item[] = [];
  private wake: (() => void) | null = null;

  constructor(readonly request: StreamSessionEventsRequest) {}

  send(item: Item): void {
    this.queue.push(item);
    this.wake?.();
  }

  async *frames(signal?: AbortSignal): AsyncGenerator<StreamSessionEventsResponse> {
    for (;;) {
      while (this.queue.length === 0) {
        if (signal?.aborted) return;
        await new Promise<void>((resolve) => {
          this.wake = resolve;
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      }
      const item = this.queue.shift()!;
      if (item.kind === "end") return;
      if (item.kind === "fail") throw item.error;
      yield item.frame;
    }
  }
}

let streams: FakeStream[] = [];
let seq = 0n;

const client = {
  session: {
    streamEvents: vi.fn((request: StreamSessionEventsRequest, signal?: AbortSignal) => {
      const stream = new FakeStream(request);
      streams.push(stream);
      return stream.frames(signal);
    }),
  },
} as unknown as Stigmer;

function Wrapper({ children }: { children: ReactNode }) {
  return <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>;
}

/** Sends events, numbered in log order, on the newest open stream. */
function send(...events: SessionEvent[]): void {
  const stream = streams.at(-1)!;
  for (const event of events) {
    seq += 1n;
    stream.send({ kind: "frame", frame: samples.eventFrame({ ...event, seq }) });
  }
}

function follow(sessionId: string | null, options?: UseSessionEventsOptions) {
  return renderHook(
    ({ id }: { id: string | null }) => useSessionEvents(id, options),
    { wrapper: Wrapper, initialProps: { id: sessionId } },
  );
}

/** Instant, deterministic reconnects unless a test asks for a visible wait. */
const QUICK: UseSessionEventsOptions = { reconnectOptions: { baseDelayMs: 0, maxDelayMs: 0 } };

beforeEach(() => {
  streams = [];
  seq = 0n;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useSessionEvents", () => {
  it("follows the whole log with every preview and publishes the fold", async () => {
    const { result } = follow("ses-1", QUICK);
    expect(result.current.isConnecting).toBe(true);
    expect(result.current.fold).toBeNull();

    await waitFor(() => expect(streams).toHaveLength(1));
    expect(streams[0]!.request).toMatchObject({
      sessionId: "ses-1",
      afterSeq: 0n,
      eventDeltas: [...ALL_SESSION_PREVIEWS],
    });

    act(() => send(...samples.turnEvents()));
    await waitFor(() => expect(result.current.fold?.turns).toHaveLength(1));
    expect(result.current.isStreaming).toBe(true);
    expect(result.current.isConnecting).toBe(false);
    expect(result.current.fold!.turns[0]!.ended).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("publishes a burst of frames once", async () => {
    const store = new ConversationStore();
    const publish = vi.spyOn(store, "publish");
    const { result } = follow("ses-1", { ...QUICK, store });
    await waitFor(() => expect(streams).toHaveLength(1));

    act(() => send(...samples.turnEvents()));
    await waitFor(() => expect(result.current.fold?.lastSeq).toBe(4n));
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("reconnects a dropped stream from the newest event, then streams again", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    const { result } = follow("ses-1", { reconnectOptions: { baseDelayMs: 40, maxDelayMs: 40 } });
    await waitFor(() => expect(streams).toHaveLength(1));
    act(() => send(...samples.turnEvents({ phase: "running" })));
    await waitFor(() => expect(result.current.isStreaming).toBe(true));

    act(() => streams[0]!.send({ kind: "end" }));
    await waitFor(() => expect(result.current.isReconnecting).toBe(true));
    expect(result.current.reconnectAttempt).toBe(1);
    expect(result.current.fold?.turns).toHaveLength(1);
    expect(result.current.error).toBeNull();

    await waitFor(() => expect(streams).toHaveLength(2));
    expect(streams[1]!.request.afterSeq).toBe(seq);

    act(() => send(samples.agentMessageEvent("back", { id: "run_00000000000000000000000001.root.m9" })));
    await waitFor(() => expect(result.current.isStreaming).toBe(true));
    expect(result.current.reconnectAttempt).toBe(0);
  });

  it("surfaces an error once the reconnects allowed run out", async () => {
    const { result } = follow("ses-1", { reconnectOptions: { baseDelayMs: 0, maxDelayMs: 0, maxAttempts: 1 } });
    await waitFor(() => expect(streams).toHaveLength(1));

    act(() => streams[0]!.send({ kind: "end" }));
    await waitFor(() => expect(streams).toHaveLength(2));
    act(() => streams[1]!.send({ kind: "end" }));

    await waitFor(() => expect(result.current.error?.message).toMatch(/interrupted/));
    expect(result.current.isReconnecting).toBe(false);
    expect(streams).toHaveLength(2);
  });

  it("surfaces the first drop as an error with autoReconnect off", async () => {
    const { result } = follow("ses-1", { autoReconnect: false });
    await waitFor(() => expect(streams).toHaveLength(1));

    act(() => streams[0]!.send({ kind: "end" }));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(streams).toHaveLength(1);
  });

  it("surfaces a refusal as the error, keeping what was folded", async () => {
    const { result } = follow("ses-1", QUICK);
    await waitFor(() => expect(streams).toHaveLength(1));
    act(() => send(...samples.turnEvents()));
    await waitFor(() => expect(result.current.fold).not.toBeNull());

    act(() => streams[0]!.send({ kind: "fail", error: new StigmerError("not-found", "session not found", 5) }));
    await waitFor(() => expect(result.current.error?.message).toMatch(/not found/));
    expect(result.current.fold?.turns).toHaveLength(1);
    expect(streams).toHaveLength(1);
  });

  it("reconnects a silent follow once, then surfaces the timeout until a manual reconnect", async () => {
    const { result } = follow("ses-1", { ...QUICK, connectTimeoutMs: 30 });
    await waitFor(() => expect(streams).toHaveLength(2));
    await waitFor(() => expect(result.current.connectTimedOut).toBe(true));
    expect(streams).toHaveLength(2);

    act(() => result.current.reconnect());
    expect(result.current.connectTimedOut).toBe(false);
    await waitFor(() => expect(streams).toHaveLength(3));

    act(() => send(samples.userMessageEvent("hi")));
    await waitFor(() => expect(result.current.isStreaming).toBe(true));
    expect(result.current.connectTimedOut).toBe(false);
  });

  it("follows nothing for a null session", () => {
    const { result } = follow(null);
    expect(streams).toHaveLength(0);
    expect(result.current).toMatchObject({
      fold: null,
      isStreaming: false,
      isConnecting: false,
      isReconnecting: false,
      error: null,
    });
  });

  it("starts another session from an empty fold, and idles when the id clears", async () => {
    const { result, rerender } = follow("ses-1", QUICK);
    await waitFor(() => expect(streams).toHaveLength(1));
    act(() => send(...samples.turnEvents()));
    await waitFor(() => expect(result.current.fold).not.toBeNull());

    rerender({ id: "ses-2" });
    await waitFor(() => expect(streams).toHaveLength(2));
    expect(result.current.fold).toBeNull();
    expect(streams[1]!.request).toMatchObject({ sessionId: "ses-2", afterSeq: 0n });

    rerender({ id: null });
    await waitFor(() => expect(result.current.isConnecting).toBe(false));
    expect(result.current.isStreaming).toBe(false);
  });

  it("is slow only while the newest turn works", async () => {
    const working = follow("ses-1", { ...QUICK, slowThresholdMs: 30 });
    await waitFor(() => expect(streams).toHaveLength(1));
    act(() => send(...samples.turnEvents({ phase: "running", reply: "" })));
    await waitFor(() => expect(working.result.current.isSlow).toBe(true));
    working.unmount();

    const idle = follow("ses-2", { ...QUICK, slowThresholdMs: 30 });
    await waitFor(() => expect(streams).toHaveLength(2));
    act(() => send(...samples.turnEvents({ runId: "run_b" })));
    await waitFor(() => expect(idle.result.current.fold).not.toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(idle.result.current.isSlow).toBe(false);
  });

  it("ends the follow when unmounted mid-reconnect", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    const { result, unmount } = follow("ses-1", { reconnectOptions: { baseDelayMs: 5_000, maxDelayMs: 5_000 } });
    await waitFor(() => expect(streams).toHaveLength(1));
    act(() => streams[0]!.send({ kind: "end" }));
    await waitFor(() => expect(result.current.isReconnecting).toBe(true));

    unmount();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(streams).toHaveLength(1);
  });
});
