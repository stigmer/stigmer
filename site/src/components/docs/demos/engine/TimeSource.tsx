"use client";

import { createContext, type ReactNode, useContext } from "react";

/**
 * Frame-based time source for deterministic playback rendering.
 *
 * When provided via {@link TimeSourceProvider}, ScenarioPlayer derives
 * step progression from {@link TimeSourceValue.currentTimeMs} instead
 * of `setTimeout`. This enables Remotion's frame-by-frame rendering
 * model where the renderer controls time, not the browser.
 */
interface TimeSourceValue {
  /** Current playback time in milliseconds. */
  currentTimeMs: number;
  /**
   * Pre-computed start time (in ms) for each step in the timeline.
   * Step i is active when `currentTimeMs >= stepStartTimesMs[i]` and
   * either i is the last step or `currentTimeMs < stepStartTimesMs[i+1]`.
   */
  stepStartTimesMs: readonly number[];
}

const TimeSourceContext = createContext<TimeSourceValue | null>(null);

interface TimeSourceProviderProps {
  currentTimeMs: number;
  stepStartTimesMs: readonly number[];
  children: ReactNode;
}

/**
 * Provide frame-based time to ScenarioPlayer and other engine
 * components. In Remotion compositions, wrap the scenario tree in
 * this provider with `currentTimeMs` derived from `useCurrentFrame()`.
 */
export function TimeSourceProvider({
  currentTimeMs,
  stepStartTimesMs,
  children,
}: TimeSourceProviderProps) {
  return (
    <TimeSourceContext.Provider value={{ currentTimeMs, stepStartTimesMs }}>
      {children}
    </TimeSourceContext.Provider>
  );
}

/**
 * Read the frame-based time source. Returns `null` when rendering in
 * normal browser playback mode (no provider present).
 */
export function useTimeSource(): TimeSourceValue | null {
  return useContext(TimeSourceContext);
}
