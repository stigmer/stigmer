"use client";

import { type RefObject, useEffect, useRef } from "react";
import type { NarrationManifest } from "./narration";
import type { ScenarioStep } from "./ScenarioPlayer";
import { useTimeSource } from "./TimeSource";
import {
  scrollTargetIntoView,
  scrollTargetIntoViewInstant,
} from "./scroll-utils";
import { CLICK_DELAY_MS, HOVER_HOLD_MS, TYPE_CHAR_DELAY_MS } from "./timing";

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
  readonly type: "scroll-to" | "set-cursor" | "clear-cursor" | "click" | "type" | "hover";
  /**
   * Target element identifier.
   * - For `scroll-to`: matches `[data-scroll-target="<target>"]`
   * - For `set-cursor` / `click` / `type` / `hover`: matches `[data-cursor-target="<target>"]`
   */
  readonly target?: string;
  /**
   * Text to type character-by-character. Only used by `type` actions.
   */
  readonly text?: string;
  /**
   * Milliseconds between characters for `type` actions.
   * Defaults to {@link TYPE_CHAR_DELAY_MS} (50ms).
   */
  readonly typeDelay?: number;
  /**
   * Milliseconds to hold the cursor over the target during a `hover`
   * action, between enter-event dispatch and leave-event dispatch.
   * Defaults to {@link HOVER_HOLD_MS} (1500ms).
   */
  readonly hoverDuration?: number;
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
  /**
   * Optional callback to control the Cursor's click ripple. The
   * `hover` action calls `setShowRipple(false)` before moving the
   * cursor and `setShowRipple(true)` after hover leave events fire.
   * Scenarios that don't use `hover` can omit this.
   */
  setShowRipple?: (show: boolean) => void;
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
 * click dispatch, text input, hover reveal) synced to narration
 * duration.
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
 * The `type` action is three-phase: cursor moves to the target
 * (phase 1), then after {@link CLICK_DELAY_MS} characters appear
 * one at a time at {@link TYPE_CHAR_DELAY_MS} intervals (phase 2+).
 * Uses the native input value setter to trigger React's onChange.
 *
 * The `hover` action is three-phase: cursor moves to the target
 * without a click ripple (phase 1), then after
 * {@link CLICK_DELAY_MS} pointer/mouse enter events are dispatched
 * and `data-hover` is set (phase 2), then after
 * {@link HOVER_HOLD_MS} leave events are dispatched and
 * `data-hover` is removed (phase 3).
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
  setShowRipple,
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
      } else if (action.type === "type") {
        const text = action.text ?? "";
        if (text.length === 0) continue;
        const charDelay = action.typeDelay ?? TYPE_CHAR_DELAY_MS;

        const cursorKey = `${stepIndex}-${action.atPercent}-type-cursor`;
        if (elapsed >= fireAt && !firedRef.current.has(cursorKey)) {
          firedRef.current.add(cursorKey);
          setCursorTarget(action.target);
        }

        const typingStart = fireAt + CLICK_DELAY_MS;
        if (elapsed >= typingStart) {
          const charCount = Math.min(
            Math.floor((elapsed - typingStart) / charDelay) + 1,
            text.length,
          );
          const charKey = `${stepIndex}-${action.atPercent}-type-char-${charCount}`;
          if (!firedRef.current.has(charKey)) {
            firedRef.current.add(charKey);
            typeTextIntoTarget(action.target, text.substring(0, charCount), containerRef);
          }
        }
      } else if (action.type === "hover") {
        const holdMs = action.hoverDuration ?? HOVER_HOLD_MS;

        const cursorKey = `${stepIndex}-${action.atPercent}-hover-cursor`;
        if (elapsed >= fireAt && !firedRef.current.has(cursorKey)) {
          firedRef.current.add(cursorKey);
          setShowRipple?.(false);
          setCursorTarget(action.target);
        }

        const enterKey = `${stepIndex}-${action.atPercent}-hover-enter`;
        if (elapsed >= fireAt + CLICK_DELAY_MS && !firedRef.current.has(enterKey)) {
          firedRef.current.add(enterKey);
          dispatchHoverEnterOnTarget(action.target, containerRef);
        }

        const leaveKey = `${stepIndex}-${action.atPercent}-hover-leave`;
        if (elapsed >= fireAt + CLICK_DELAY_MS + holdMs && !firedRef.current.has(leaveKey)) {
          firedRef.current.add(leaveKey);
          dispatchHoverLeaveOnTarget(action.target, containerRef);
          setShowRipple?.(true);
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
      } else if (action.type === "type") {
        const text = action.text ?? "";
        if (text.length === 0) continue;
        const charDelay = action.typeDelay ?? TYPE_CHAR_DELAY_MS;

        warnIfTypingExceedsStep(action, charDelay, duration, stepIndex);

        timers.push(
          setTimeout(() => setCursorTarget(action.target), fireAt),
        );

        const typingStart = fireAt + CLICK_DELAY_MS / rate;
        for (let i = 0; i < text.length; i++) {
          const chars = text.substring(0, i + 1);
          timers.push(
            setTimeout(
              () => typeTextIntoTarget(action.target, chars, containerRef),
              typingStart + (i * charDelay) / rate,
            ),
          );
        }
      } else if (action.type === "hover") {
        const holdMs = action.hoverDuration ?? HOVER_HOLD_MS;

        warnIfHoverExceedsStep(action, holdMs, duration, stepIndex);

        timers.push(
          setTimeout(() => {
            setShowRipple?.(false);
            setCursorTarget(action.target);
          }, fireAt),
        );
        timers.push(
          setTimeout(
            () => dispatchHoverEnterOnTarget(action.target, containerRef),
            fireAt + CLICK_DELAY_MS / rate,
          ),
        );
        timers.push(
          setTimeout(() => {
            dispatchHoverLeaveOnTarget(action.target, containerRef);
            setShowRipple?.(true);
          }, fireAt + (CLICK_DELAY_MS + holdMs) / rate),
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
    setShowRipple,
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
    case "type":
    case "hover":
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

// ---------------------------------------------------------------------------
// Type dispatch
// ---------------------------------------------------------------------------

/**
 * Resolve a `[data-cursor-target]` element to the underlying
 * `<input>` or `<textarea>`. If the target element is itself an
 * input, it is returned directly; otherwise the first descendant
 * input or textarea is used.
 */
function resolveInput(
  target: string,
  containerRef: RefObject<HTMLElement | null>,
): HTMLInputElement | HTMLTextAreaElement | null {
  const container = containerRef.current;
  if (!container) return null;

  const targetEl = container.querySelector(
    `[data-cursor-target="${target}"]`,
  );
  if (!targetEl) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[StepInteractions] type target "${target}" not found in DOM. ` +
          `Ensure a [data-cursor-target="${target}"] element exists in the container.`,
      );
    }
    return null;
  }

  if (
    targetEl instanceof HTMLInputElement ||
    targetEl instanceof HTMLTextAreaElement
  ) {
    return targetEl;
  }

  const input = targetEl.querySelector<
    HTMLInputElement | HTMLTextAreaElement
  >("input, textarea");

  if (!input) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[StepInteractions] type target "${target}" has no <input> or <textarea> descendant. ` +
          `Either add data-cursor-target directly to the input, or ensure an input exists inside the target element.`,
      );
    }
    return null;
  }

  return input;
}

/**
 * Dev-mode warning when typing animation would be cut short because
 * it takes longer than the step's duration. Fires once per action
 * when timers are scheduled, not per character.
 */
function warnIfTypingExceedsStep(
  action: StepAction,
  charDelay: number,
  stepDurationMs: number,
  stepIdx: number,
): void {
  if (process.env.NODE_ENV !== "development") return;

  const text = action.text ?? "";
  const typingDuration =
    action.atPercent * stepDurationMs + CLICK_DELAY_MS + text.length * charDelay;
  if (typingDuration > stepDurationMs) {
    console.warn(
      `[StepInteractions] type action in step ${stepIdx} at ${action.atPercent} ` +
        `needs ~${Math.round(typingDuration)}ms but step is only ${Math.round(stepDurationMs)}ms. ` +
        `Typing will be cut short when the step advances. ` +
        `Reduce text length, decrease typeDelay, or increase step duration.`,
    );
  }
}

/**
 * Dev-mode warning when a hover action's total duration (cursor
 * travel + hold) exceeds the step's duration, meaning leave events
 * will be cut short when the step advances.
 */
function warnIfHoverExceedsStep(
  action: StepAction,
  hoverDuration: number,
  stepDurationMs: number,
  stepIdx: number,
): void {
  if (process.env.NODE_ENV !== "development") return;

  const totalMs =
    action.atPercent * stepDurationMs + CLICK_DELAY_MS + hoverDuration;
  if (totalMs > stepDurationMs) {
    console.warn(
      `[StepInteractions] hover action in step ${stepIdx} at ${action.atPercent} ` +
        `needs ~${Math.round(totalMs)}ms but step is only ${Math.round(stepDurationMs)}ms. ` +
        `Leave events will not fire before the step advances. ` +
        `Reduce hoverDuration or increase step duration.`,
    );
  }
}

/**
 * Set an input's value to `text` using the native property setter,
 * then dispatch a bubbling `input` event so React's synthetic
 * onChange fires.
 *
 * This is the same `nativeInputValueSetter` pattern used by
 * TypingComposer and PrefilledCreateForm, extracted here so the
 * engine can drive character-by-character typing without
 * scenario-specific wrappers.
 */
function typeTextIntoTarget(
  target: string | undefined,
  text: string,
  containerRef: RefObject<HTMLElement | null>,
): void {
  if (!target) return;

  const input = resolveInput(target, containerRef);
  if (!input) return;

  const proto =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

// ---------------------------------------------------------------------------
// Hover dispatch
// ---------------------------------------------------------------------------

/**
 * Resolve a `[data-cursor-target]` element to an `HTMLElement`.
 * Returns `null` (with a dev-mode warning) if not found.
 */
function resolveHoverTarget(
  target: string | undefined,
  containerRef: RefObject<HTMLElement | null>,
): HTMLElement | null {
  if (!target) return null;

  const container = containerRef.current;
  if (!container) return null;

  const el = container.querySelector(`[data-cursor-target="${target}"]`);
  if (!el || !(el instanceof HTMLElement)) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[StepInteractions] hover target "${target}" not found in DOM. ` +
          `Ensure a [data-cursor-target="${target}"] element exists and is an HTMLElement.`,
      );
    }
    return null;
  }

  return el;
}

/**
 * Dispatch pointer and mouse enter events on the target element and
 * set `data-hover="true"` to enable CSS hover-state styling.
 *
 * Dispatches four events matching the browser's native hover
 * sequence: `pointerenter` and `pointerover` (for Radix UI and
 * pointer-event listeners), then `mouseenter` and `mouseover` (for
 * legacy mouse-event listeners). `enter`/`leave` events don't
 * bubble; `over`/`out` events do — matching browser behavior.
 */
function dispatchHoverEnterOnTarget(
  target: string | undefined,
  containerRef: RefObject<HTMLElement | null>,
): void {
  const el = resolveHoverTarget(target, containerRef);
  if (!el) return;

  el.dispatchEvent(new PointerEvent("pointerenter", { bubbles: false }));
  el.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
  el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  el.setAttribute("data-hover", "true");
}

/**
 * Dispatch pointer and mouse leave events on the target element and
 * remove the `data-hover` attribute.
 */
function dispatchHoverLeaveOnTarget(
  target: string | undefined,
  containerRef: RefObject<HTMLElement | null>,
): void {
  const el = resolveHoverTarget(target, containerRef);
  if (!el) return;

  el.dispatchEvent(new PointerEvent("pointerleave", { bubbles: false }));
  el.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false }));
  el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
  el.removeAttribute("data-hover");
}
