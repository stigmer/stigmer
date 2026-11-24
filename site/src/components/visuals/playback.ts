"use client";

/**
 * The docs' one way of playing a timed sequence: a terminal recording's
 * frames.
 *
 * `usePlayback(times)` steps through `times` (each step's moment, in
 * milliseconds from the start) on their own gaps, starting once the element
 * behind `box` scrolls into view. It pauses and plays on from `toggle`, which
 * replays from the start once it has ended. A reader who asked for less
 * motion gets the last step at once, and nothing plays: `reduced` is true and
 * `toggle` does nothing.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

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
  /** Pauses, plays on, or once ended replays from the first step. */
  readonly toggle: () => void;
}

/** Whether the reader asked for less motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function usePlayback(times: readonly number[]): Playback {
  const last = times.length - 1;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [reduced, setReduced] = useState(false);
  const box = useRef<HTMLElement>(null);

  // Under reduced motion the sequence is its last step; otherwise it starts once scrolled into view.
  useEffect(() => {
    if (prefersReducedMotion()) {
      setReduced(true);
      setIndex(last);
      return;
    }
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
  }, [last]);

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
  const toggle = useCallback(() => {
    if (reduced) return;
    // Once ended, a toggle plays again from the first step.
    if (done) setIndex(0);
    setPlaying((now) => done || !now);
  }, [reduced, done]);

  return { index, playing, done, reduced, box, toggle };
}
