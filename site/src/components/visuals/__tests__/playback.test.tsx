/**
 * `usePlayback`, the docs' playback engine: it steps on its own gaps once in
 * view; a toggle pauses it and plays it on; once ended a toggle replays from
 * the first step; and under reduced motion it holds the last step and does
 * nothing when asked to play. `<TerminalRecording>`'s tests prove it as its
 * player.
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlayback } from "../playback";

const TIMES = [0, 100, 300];

let observed: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
let reduced = false;

beforeEach(() => {
  vi.useFakeTimers();
  reduced = false;
  observed = undefined;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        observed = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: reduced && query.includes("reduce") }));
  window.matchMedia = globalThis.matchMedia;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The hook with its box mounted, as a player's figure mounts it. */
function played() {
  const box = document.createElement("figure");
  return renderHook(() => {
    const playback = usePlayback(TIMES);
    playback.box.current = box;
    return playback;
  });
}

describe("usePlayback", () => {
  it("steps on its own gaps once in view, and stops at the last step", () => {
    const { result } = played();
    expect(result.current.playing).toBe(false);
    act(() => observed?.([{ isIntersecting: true }]));
    act(() => vi.advanceTimersByTime(100));
    expect(result.current.index).toBe(1);
    act(() => vi.advanceTimersByTime(200));
    act(() => vi.advanceTimersByTime(0));
    expect(result.current).toMatchObject({ index: 2, done: true, playing: false });
  });

  it("waits out of view, pauses and plays on from a toggle, and replays from the first step once ended", () => {
    const { result } = played();
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current).toMatchObject({ index: 0, playing: false });
    act(() => observed?.([{ isIntersecting: false }]));
    expect(result.current.playing).toBe(false);
    act(() => observed?.([{ isIntersecting: true }]));
    act(() => vi.advanceTimersByTime(100));
    expect(result.current.index).toBe(1);
    act(() => result.current.toggle());
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current).toMatchObject({ index: 1, playing: false });
    act(() => result.current.toggle());
    act(() => vi.advanceTimersByTime(200));
    expect(result.current.index).toBe(2);
    act(() => result.current.toggle());
    expect(result.current).toMatchObject({ index: 0, playing: true });
  });

  it("holds the last step under reduced motion, and plays nothing when asked", () => {
    reduced = true;
    const { result } = played();
    expect(result.current).toMatchObject({ index: 2, reduced: true, done: true });
    expect(observed).toBeUndefined();
    act(() => result.current.toggle());
    act(() => vi.advanceTimersByTime(1_000));
    expect(result.current).toMatchObject({ index: 2, playing: false });
  });
});
