/**
 * Proves useSessionEvents (../useSessionEvents.ts): one follow of the
 * session's log (all previews, from the start) whose frames are folded and
 * published once per animation frame; a dropped stream reconnects with
 * backoff from the newest event folded, showing `isReconnecting` and
 * streaming again on the next frame; a caller's `maxAttempts` (or none,
 * with `autoReconnect: false`) running out is an error, as is a refusal; a
 * stream that stayed open thirty seconds starts the backoff over; a shown
 * tab, a returned network or `wake` cuts a backoff wait short, and leaves a
 * streaming follow, a refusal and a drop with `autoReconnect: false` alone;
 * a silent follow is reconnected once, then `connectTimedOut` is surfaced
 * until a manual `reconnect`; a null id follows nothing; another session
 * starts from an empty fold; `isSlow` only while the newest turn works;
 * unmounting mid-reconnect ends the follow. And what a person who leaves a
 * tab for twenty minutes comes back to (stigmer#2418): a follow that rode
 * the outage out and resumed after the newest event, and one that follows
 * again when the tab is shown or the network returns after a capped follow
 * gave up.
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
import { ConversationStore } from "../../internal/store/conversation-store";
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
/** While set, every stream opened fails at once as an unreachable server does. */
let unreachable = false;

const client = {
  session: {
    streamEvents: vi.fn((request: StreamSessionEventsRequest, signal?: AbortSignal) => {
      const stream = new FakeStream(request);
      streams.push(stream);
      if (unreachable) stream.send({ kind: "fail", error: new StigmerError("unavailable", "connection refused", 14) });
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

/** An event the turn adds once the follow is back; its id is past every sample turn's. */
const LATER = samples.agentMessageEvent("still here", { id: "run_00000000000000000000000001.root.m9" });

/** Instant, deterministic reconnects unless a test asks for a visible wait. */
const QUICK: UseSessionEventsOptions = { reconnectOptions: { baseDelayMs: 0, maxDelayMs: 0 } };

beforeEach(() => {
  streams = [];
  seq = 0n;
  unreachable = false;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useSessionEvents", () => {
  it("follows the whole log with every preview and publishes the fold", async () => {
    const { result } = follow("ses_1", QUICK);
    expect(result.current.isConnecting).toBe(true);
    expect(result.current.fold).toBeNull();

    await waitFor(() => expect(streams).toHaveLength(1));
    expect(streams[0]!.request).toMatchObject({
      sessionId: "ses_1",
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
    const { result } = follow("ses_1", { ...QUICK, store });
    await waitFor(() => expect(streams).toHaveLength(1));

    act(() => send(...samples.turnEvents()));
    await waitFor(() => expect(result.current.fold?.lastSeq).toBe(4n));
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("reconnects a dropped stream from the newest event, then streams again", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    const { result } = follow("ses_1", { reconnectOptions: { baseDelayMs: 40, maxDelayMs: 40 } });
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
    const { result } = follow("ses_1", { reconnectOptions: { baseDelayMs: 0, maxDelayMs: 0, maxAttempts: 1 } });
    await waitFor(() => expect(streams).toHaveLength(1));

    act(() => streams[0]!.send({ kind: "end" }));
    await waitFor(() => expect(streams).toHaveLength(2));
    act(() => streams[1]!.send({ kind: "end" }));

    await waitFor(() => expect(result.current.error?.message).toMatch(/interrupted/));
    expect(result.current.isReconnecting).toBe(false);
    expect(streams).toHaveLength(2);
  });

  it("surfaces the first drop as an error with autoReconnect off", async () => {
    const { result } = follow("ses_1", { autoReconnect: false });
    await waitFor(() => expect(streams).toHaveLength(1));

    act(() => streams[0]!.send({ kind: "end" }));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(streams).toHaveLength(1);
  });

  it("surfaces a refusal as the error, keeping what was folded", async () => {
    const { result } = follow("ses_1", QUICK);
    await waitFor(() => expect(streams).toHaveLength(1));
    act(() => send(...samples.turnEvents()));
    await waitFor(() => expect(result.current.fold).not.toBeNull());

    act(() => streams[0]!.send({ kind: "fail", error: new StigmerError("not-found", "session not found", 5) }));
    await waitFor(() => expect(result.current.error?.message).toMatch(/not found/));
    expect(result.current.fold?.turns).toHaveLength(1);
    expect(streams).toHaveLength(1);
  });

  it("reconnects a silent follow once, then surfaces the timeout until a manual reconnect", async () => {
    const { result } = follow("ses_1", { ...QUICK, connectTimeoutMs: 30 });
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
    const { result, rerender } = follow("ses_1", QUICK);
    await waitFor(() => expect(streams).toHaveLength(1));
    act(() => send(...samples.turnEvents()));
    await waitFor(() => expect(result.current.fold).not.toBeNull());

    rerender({ id: "ses_2" });
    await waitFor(() => expect(streams).toHaveLength(2));
    expect(result.current.fold).toBeNull();
    expect(streams[1]!.request).toMatchObject({ sessionId: "ses_2", afterSeq: 0n });

    rerender({ id: null });
    await waitFor(() => expect(result.current.isConnecting).toBe(false));
    expect(result.current.isStreaming).toBe(false);
  });

  it("is slow only while the newest turn works", async () => {
    const working = follow("ses_1", { ...QUICK, slowThresholdMs: 30 });
    await waitFor(() => expect(streams).toHaveLength(1));
    act(() => send(...samples.turnEvents({ phase: "running", reply: "" })));
    await waitFor(() => expect(working.result.current.isSlow).toBe(true));
    working.unmount();

    const idle = follow("ses_2", { ...QUICK, slowThresholdMs: 30 });
    await waitFor(() => expect(streams).toHaveLength(2));
    act(() => send(...samples.turnEvents({ runId: "run_b" })));
    await waitFor(() => expect(idle.result.current.fold).not.toBeNull());
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(idle.result.current.isSlow).toBe(false);
  });

  it("starts the backoff over after a stream that stayed open thirty seconds", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(Math, "random").mockReturnValue(1);
      const { result } = follow("ses_1", { connectTimeoutMs: 60 * 60_000 });
      await act(() => vi.advanceTimersByTimeAsync(0));
      act(() => streams[0]!.send({ kind: "end" }));
      await act(() => vi.advanceTimersByTimeAsync(1_000));
      expect(streams).toHaveLength(2);
      act(() => streams[1]!.send({ kind: "end" }));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(result.current.reconnectAttempt, "a stream that ends at once keeps backing off").toBe(2);
      await act(() => vi.advanceTimersByTimeAsync(2_000));
      expect(streams).toHaveLength(3);

      // Open thirty seconds and silent, as a proxy's idle close leaves it.
      await act(() => vi.advanceTimersByTimeAsync(30_000));
      act(() => streams[2]!.send({ kind: "end" }));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(result.current.reconnectAttempt).toBe(1);
      await act(() => vi.advanceTimersByTimeAsync(1_000));
      expect(streams, "re-opened within the first backoff step").toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["the tab is shown", () => document.dispatchEvent(new Event("visibilitychange"))],
    ["the network returns", () => window.dispatchEvent(new Event("online"))],
  ])("re-opens a follow waiting out its backoff when %s", async (_when, fire) => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    const { result } = follow("ses_1", { reconnectOptions: { baseDelayMs: 60_000, maxDelayMs: 60_000 } });
    await waitFor(() => expect(streams).toHaveLength(1));
    act(() => streams[0]!.send({ kind: "end" }));
    await waitFor(() => expect(result.current.isReconnecting).toBe(true));

    act(() => fire());
    await waitFor(() => expect(streams).toHaveLength(2), { timeout: 500 });
    expect(streams[1]!.request.afterSeq).toBe(0n);
    act(() => send(LATER));
    await waitFor(() => expect(result.current.isStreaming).toBe(true));
  });

  it("re-opens a follow waiting out its backoff on wake", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    const { result } = follow("ses_1", { reconnectOptions: { baseDelayMs: 60_000, maxDelayMs: 60_000 } });
    await waitFor(() => expect(streams).toHaveLength(1));
    act(() => streams[0]!.send({ kind: "end" }));
    await waitFor(() => expect(result.current.isReconnecting).toBe(true));

    act(() => result.current.wake());
    await waitFor(() => expect(streams).toHaveLength(2), { timeout: 500 });
  });

  it("leaves a streaming follow, a refusal and a drop with autoReconnect off alone when woken", async () => {
    const wakeAll = (wake: () => void) =>
      act(() => {
        wake();
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("online"));
      });

    const streaming = follow("ses_1", QUICK);
    await waitFor(() => expect(streams).toHaveLength(1));
    act(() => send(...samples.turnEvents({ phase: "running" })));
    await waitFor(() => expect(streaming.result.current.isStreaming).toBe(true));
    wakeAll(streaming.result.current.wake);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(streams).toHaveLength(1);
    streaming.unmount();

    const refused = follow("ses_2", QUICK);
    await waitFor(() => expect(streams).toHaveLength(2));
    act(() => streams[1]!.send({ kind: "fail", error: new StigmerError("not-found", "session not found", 5) }));
    await waitFor(() => expect(refused.result.current.error?.message).toMatch(/not found/));
    wakeAll(refused.result.current.wake);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(streams).toHaveLength(2);
    expect(refused.result.current.error?.message).toMatch(/not found/);
    refused.unmount();

    const manual = follow("ses-3", { autoReconnect: false });
    await waitFor(() => expect(streams).toHaveLength(3));
    act(() => streams[2]!.send({ kind: "end" }));
    await waitFor(() => expect(manual.result.current.error).not.toBeNull());
    wakeAll(manual.result.current.wake);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(streams).toHaveLength(3);
  });

  it("ends the follow when unmounted mid-reconnect", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    const { result, unmount } = follow("ses_1", { reconnectOptions: { baseDelayMs: 5_000, maxDelayMs: 5_000 } });
    await waitFor(() => expect(streams).toHaveLength(1));
    act(() => streams[0]!.send({ kind: "end" }));
    await waitFor(() => expect(result.current.isReconnecting).toBe(true));

    unmount();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(streams).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// A long outage: a tab left for twenty minutes, a laptop lid closed.
// ---------------------------------------------------------------------------

describe("useSessionEvents — a long outage", () => {
  it("rides out a twenty-minute outage and resumes after the newest event, with nothing missing or doubled", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(Math, "random").mockReturnValue(1);
      const { result } = follow("ses_1");
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(streams).toHaveLength(1);
      act(() => send(...samples.turnEvents({ phase: "running", reply: "" })));
      await act(() => vi.advanceTimersByTimeAsync(50));
      const folded = result.current.fold!.lastSeq;

      unreachable = true;
      act(() => streams[0]!.send({ kind: "end" }));
      for (let elapsed = 0; elapsed < 20 * 60_000; elapsed += 10_000) await act(() => vi.advanceTimersByTimeAsync(10_000));
      unreachable = false;
      await act(() => vi.advanceTimersByTimeAsync(60_000));

      expect(result.current.error, "no error once the server is back").toBeNull();
      expect(streams.at(-1)!.request.afterSeq, "the follow resumed after the newest event folded").toBe(folded);
      act(() => send(LATER));
      await act(() => vi.advanceTimersByTimeAsync(50));
      expect(result.current.isStreaming).toBe(true);
      expect(result.current.fold!.lastSeq, "nothing missing").toBe(seq);
      expect(result.current.fold!.turns, "nothing doubled").toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("follows again when the tab is shown or the network returns after a follow gave up", async () => {
    const { result } = follow("ses_1", { reconnectOptions: { baseDelayMs: 0, maxDelayMs: 0, maxAttempts: 1 } });
    await waitFor(() => expect(streams).toHaveLength(1));
    act(() => send(...samples.turnEvents({ phase: "running", reply: "" })));
    await waitFor(() => expect(result.current.fold).not.toBeNull());
    unreachable = true;
    act(() => streams[0]!.send({ kind: "end" }));
    await waitFor(() => expect(result.current.error?.message).toMatch(/interrupted/));
    const opened = streams.length;

    unreachable = false;
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Promptly: the person is looking at the tab now.
    await waitFor(() => expect(streams.length, "a new follow opened").toBeGreaterThan(opened), { timeout: 500 });
    act(() => send(LATER));
    await waitFor(() => expect(result.current.isStreaming).toBe(true));
    expect(result.current.error).toBeNull();
  });
});
