import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, cleanup } from "@testing-library/react";
import { useEffect, useState } from "react";
import { useFetch } from "../useFetch";
import { advanceInSlices } from "./fake-timer-slices";

/**
 * The F-14 starvation net (channel-conversations T06): a polling
 * `useFetch` must keep its interval's phase across re-renders of its
 * host component.
 *
 * Every real consumer passes an inline closure as `fetchFn`, which is
 * referentially new on each render. If the interval effect keys on that
 * identity, any co-mounted render source with a period shorter than the
 * poll interval tears the timer down before it can ever fire — the
 * interval needs an uninterrupted `refetchInterval` window that
 * structurally never arrives. In production this starved the
 * conversation timeline (5s poll) and inbox (20s poll) under
 * `useConversation`'s 5s render cadence, deterministically.
 *
 * The ticker period here (600ms) is deliberately SHORTER than the poll
 * interval (1000ms) and misaligned with it. Do not "simplify" this to
 * aligned periods: when both timers share a phase under fake timers,
 * both callbacks fire inside the same advanced instant — before React
 * commits the re-render that would tear the poll timer down — and the
 * starvation never manifests, leaving a test that cannot fail.
 */

/** Calls `useFetch` the way every real consumer does: inline closure. */
function PollingConsumer({ onFetch }: { readonly onFetch: () => void }) {
  useFetch(
    async () => {
      onFetch();
      return "ok";
    },
    [],
    "",
    { refetchInterval: 1000 },
  );
  return null;
}

/** Re-renders its subtree every 600ms — the fast co-mounted render source. */
function RenderPressureHost({ onFetch }: { readonly onFetch: () => void }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 600);
    return () => clearInterval(id);
  }, []);
  return <PollingConsumer onFetch={onFetch} />;
}

describe("useFetch — polling under render pressure (F-14)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("keeps polling while a faster sibling re-renders the consumer every 600ms", async () => {
    const onFetch = vi.fn();
    render(<RenderPressureHost onFetch={onFetch} />);

    // Flush the initial fetch.
    await act(async () => {
      await Promise.resolve();
    });
    expect(onFetch).toHaveBeenCalledTimes(1);

    // 3 seconds under render pressure: the ticker re-renders at 600ms,
    // 1200ms, 1800ms, 2400ms, 3000ms. The poll interval must still fire
    // at 1000ms, 2000ms, and 3000ms — its phase survives the renders.
    await advanceInSlices(3000);
    expect(onFetch).toHaveBeenCalledTimes(4);
  });
});
