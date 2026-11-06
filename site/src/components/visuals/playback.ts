"use client";

/**
 * The docs' one way of playing a timed sequence: a terminal recording's
 * frames, or the first-job block's two tabs.
 *
 * `usePlayback(times)` steps through `times` (each step's moment, in
 * milliseconds from the start) on their own gaps. By default it starts once
 * the element behind `box` scrolls into view; `startInView: false` waits for
 * `replay`, for a sequence that plays when chosen. It pauses and plays on from
 * `toggle`, which replays from the start once it has ended. A reader who asked
 * for less motion gets the last step at once, and nothing plays: `reduced` is
 * true and `replay` and `toggle` do nothing.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export interface PlaybackOptions {
  /** Start when `box` scrolls into view (the default), or only on `replay`. */
  startInView?: boolean;
}

export interface Playback {
  /** The step showing now. */
  readonly index: number;
  readonly playing: boolean;
  /** The last step is showing. */
  readonly done: boolean;
  /** The reader asked for less motion: the last step shows and nothing plays. */
  readonly reduced: boolean;
  /** The element whose scrolling into view starts the playback. */
  readonly box: RefObject<HTMLElement | null>;
  /** Plays from the first step. */
  readonly replay: () => void;
  /** Pauses, plays on, or once ended replays. */
  readonly toggle: () => void;
  /** Stops where it is. */
  readonly pause: () => void;
}

/** Whether the reader asked for less motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function usePlayback(times: readonly number[], { startInView = true }: PlaybackOptions = {}): Playback {
  const last = times.length - 1;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reduced, setReduced] = useState(false);
  const box = useRef<HTMLElement>(null);

  // Under reduced motion the sequence is its last step; otherwise it may start once scrolled into view.
  useEffect(() => {
    if (prefersReducedMotion()) {
      setReduced(true);
      setIndex(last);
      return;
    }
    if (!startInView) return;
    // The box is mounted before its effects run, so it is always there.
    const element = box.current!;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setPlaying(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [last, startInView]);

  useEffect(() => {
    if (!playing) return;
    if (index >= last) {
      setPlaying(false);
      return;
    }
    const timer = setTimeout(() => setIndex((at) => at + 1), times[index + 1]! - times[index]!);
    return () => clearTimeout(timer);
  }, [playing, index, last, times]);

  const done = index >= last;
  const replay = useCallback(() => {
    if (reduced) return;
    setIndex(0);
    setPlaying(true);
  }, [reduced]);
  const toggle = useCallback(() => {
    if (reduced) return;
    if (done) replay();
    else setPlaying((now) => !now);
  }, [reduced, done, replay]);
  const pause = useCallback(() => setPlaying(false), []);

  return { index, playing, done, reduced, box, replay, toggle, pause };
}
