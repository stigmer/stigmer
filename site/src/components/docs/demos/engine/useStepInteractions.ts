"use client";

import { type RefObject, useEffect, useRef } from "react";
import type { NarrationManifest } from "./narration";
import type { ScenarioStep } from "./ScenarioPlayer";
import { useTimeSource } from "./TimeSource";
import {
  scrollTargetIntoView,
  scrollTargetIntoViewInstant,
} from "./scroll-utils";
import { CLICK_DELAY_MS } from "./timing";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single timed interaction within a step. */
export interface StepAction {
  /**
   * When to fire, as a fraction of the step's narration duration
   * (0.0 = step start, 1.0 = narration end). The hook reads the
   * narration manifest to compute the real millisecond time.
   *
   * When no narration is available (muted / no manifest), the next
   * step's `delayMs` is used as the fallback step duration.
   */
  readonly atPercent: number;
  /** Action type. */
  readonly type: "scroll-to" | "set-cursor" | "clear-cursor" | "click";
  /**
   * Target element identifier.
   * - For `scroll-to`: matches `[data-scroll-target="<target>"]`
   * - For `set-cursor` / `click`: matches `[data-cursor-target="<target>"]`
   */
  readonly target?: string;
}

/**
 * Map of step index → ordered array of timed actions for that step.
 * Steps not listed have no mid-step interactions.
 */
export type StepInteractions = Readonly<Record<number, readonly StepAction[]>>;

/** Configuration for the useStepInteractions hook. */
export interface UseStepInteractionsOptions<T> {
  /** Current active step index from ScenarioPlayer. */
  stepIndex: number;
  /** Timed actions keyed by step index. */
  interactions: StepInteractions;
  /** Narration manifest for duration lookup. */
  narrationManifest: NarrationManifest | undefined;
  /** Container ref for DOM queries. */
  containerRef: RefObject<HTMLElement | null>;
  /** Callback to change the cursor target mid-step. */
  setCursorTarget: (target: string | undefined) => void;
  /** The full steps array (used for fallback duration from delayMs). */
  steps: readonly ScenarioStep<T>[];
  /**
   * Playback speed multiplier (default 1). Browser-path timeouts are
   * divided by this value so interactions fire proportionally earlier
   * at higher speeds.
   */
  playbackRate?: number;
}

// ---------------------------------------------------------------------------
// Duration helpers
// ---------------------------------------------------------------------------

function getStepDurationMs<T>(
  stepIndex: number,
  manifest: NarrationManifest | undefined,
  steps: readonly ScenarioStep<T>[],
): number {
  const narrationMs = manifest?.steps[stepIndex]?.durationMs;
  if (narrationMs && narrationMs > 0) return narrationMs;

  const nextStep = steps[stepIndex + 1];
  return nextStep ? nextStep.delayMs : 3000;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Schedule timed mid-step interactions (scroll, cursor movement,
 * click dispatch) synced to narration duration.
 *
 * In browser mode, actions are scheduled via `setTimeout` at
 * `atPercent * stepDuration` ms from step start. In Remotion
 * video-export mode, actions fire synchronously when the frame
 * time crosses the action's threshold.
 *
 * The `click` action is two-phase: it first moves the cursor to
 * the target (phase 1), then dispatches a native DOM click after
 * {@link CLICK_DELAY_MS} so the cursor ripple is visible before
 * the UI reacts.
 *
 * Opt-in: scenarios that don't call this hook are unaffected.
 */
export function useStepInteractions<T>({
  stepIndex,
  interactions,
  narrationManifest,
  containerRef,
  setCursorTarget,
  steps,
  playbackRate = 1,
}: UseStepInteractionsOptions<T>): void {
  const timeSource = useTimeSource();
  const firedRef = useRef<Set<string>>(new Set());

  // -----------------------------------------------------------------------
  // Video-export path: synchronous, frame-driven
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (!timeSource) return;

    const actions = interactions[stepIndex];
    if (!actions || actions.length === 0) return;

    const stepStartMs = timeSource.stepStartTimesMs[stepIndex] ?? 0;
    const nextStepStartMs = timeSource.stepStartTimesMs[stepIndex + 1];
    const stepDuration = nextStepStartMs
      ? nextStepStartMs - stepStartMs
      : getStepDurationMs(stepIndex, narrationManifest, steps);

    const elapsed = timeSource.currentTimeMs - stepStartMs;

    for (const action of actions) {
      const fireAt = action.atPercent * stepDuration;

      if (action.type === "click") {
        const cursorKey = `${stepIndex}-${action.atPercent}-click-cursor`;
        if (elapsed >= fireAt && !firedRef.current.has(cursorKey)) {
          firedRef.current.add(cursorKey);
          setCursorTarget(action.target);
        }

        const dispatchKey = `${stepIndex}-${action.atPercent}-click-dispatch`;
        if (elapsed >= fireAt + CLICK_DELAY_MS && !firedRef.current.has(dispatchKey)) {
          firedRef.current.add(dispatchKey);
          dispatchClickOnTarget(action.target, containerRef);
        }
      } else {
        const key = `${stepIndex}-${action.atPercent}-${action.type}`;
        if (elapsed >= fireAt && !firedRef.current.has(key)) {
          firedRef.current.add(key);
          executeAction(action, containerRef, setCursorTarget, true);
        }
      }
    }
  });

  // Reset fired set when step changes in video mode
  useEffect(() => {
    if (timeSource) {
      firedRef.current.clear();
    }
  }, [timeSource, stepIndex]);

  // -----------------------------------------------------------------------
  // Browser path: setTimeout-driven
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (timeSource) return;

    const actions = interactions[stepIndex];
    if (!actions || actions.length === 0) return;

    const duration = getStepDurationMs(stepIndex, narrationManifest, steps);
    const rate = Math.max(playbackRate, 0.25);
    const timers: ReturnType<typeof setTimeout>[] = [];

    for (const action of actions) {
      const fireAt = (action.atPercent * duration) / rate;

      if (action.type === "click") {
        timers.push(
          setTimeout(() => setCursorTarget(action.target), fireAt),
        );
        timers.push(
          setTimeout(
            () => dispatchClickOnTarget(action.target, containerRef),
            fireAt + CLICK_DELAY_MS / rate,
          ),
        );
      } else {
        timers.push(
          setTimeout(
            () => executeAction(action, containerRef, setCursorTarget, false),
            fireAt,
          ),
        );
      }
    }

    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [
    timeSource,
    stepIndex,
    interactions,
    narrationManifest,
    containerRef,
    setCursorTarget,
    steps,
    playbackRate,
  ]);
}

// ---------------------------------------------------------------------------
// Action executor
// ---------------------------------------------------------------------------

function executeAction(
  action: StepAction,
  containerRef: RefObject<HTMLElement | null>,
  setCursorTarget: (target: string | undefined) => void,
  isVideoExport: boolean,
): void {
  switch (action.type) {
    case "scroll-to": {
      if (!action.target) return;
      const container = containerRef.current;
      if (!container) return;
      const el = container.querySelector(
        `[data-scroll-target="${action.target}"]`,
      );
      if (!el) {
        if (process.env.NODE_ENV === "development") {
          console.warn(
            `[StepInteractions] scroll-to target "${action.target}" not found in DOM. ` +
              `Ensure a [data-scroll-target="${action.target}"] element exists in the container.`,
          );
        }
        return;
      }
      if (isVideoExport) {
        scrollTargetIntoViewInstant(el);
      } else {
        scrollTargetIntoView(el);
      }
      break;
    }

    case "set-cursor": {
      if (process.env.NODE_ENV === "development" && action.target) {
        const container = containerRef.current;
        if (container) {
          const el = container.querySelector(
            `[data-cursor-target="${action.target}"]`,
          );
          if (!el) {
            console.warn(
              `[StepInteractions] set-cursor target "${action.target}" not found in DOM. ` +
                `Ensure a [data-cursor-target="${action.target}"] element exists in the container.`,
            );
          }
        }
      }
      setCursorTarget(action.target);
      break;
    }

    case "clear-cursor":
      setCursorTarget(undefined);
      break;

    case "click":
      setCursorTarget(action.target);
      break;
  }
}

// ---------------------------------------------------------------------------
// Click dispatch
// ---------------------------------------------------------------------------

/**
 * Find the cursor-target element and dispatch a native click on it.
 *
 * Uses `HTMLElement.click()` which fires through React's event
 * delegation, triggering the component's `onClick` handler normally.
 */
function dispatchClickOnTarget(
  target: string | undefined,
  containerRef: RefObject<HTMLElement | null>,
): void {
  if (!target) return;

  const container = containerRef.current;
  if (!container) return;

  const el = container.querySelector(`[data-cursor-target="${target}"]`);
  if (!el || !(el instanceof HTMLElement)) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[StepInteractions] click target "${target}" not found in DOM. ` +
          `Ensure a [data-cursor-target="${target}"] element exists and is an HTMLElement.`,
      );
    }
    return;
  }

  el.click();
}
