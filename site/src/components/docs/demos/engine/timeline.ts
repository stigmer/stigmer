import type { NarrationManifest } from "./narration";

/**
 * Minimal step shape for timeline computation. Accepts any
 * ScenarioStep<T> without caring about the data payload.
 */
interface StepTiming {
  delayMs: number;
}

/** Dwell time on the final step so viewers can absorb the result. */
const FINAL_DWELL_MS = 3_000;

export interface StepTimeline {
  /** Start time of each step in milliseconds (index 0 is always 0). */
  stepStartTimesMs: number[];
  /** Total playback duration in milliseconds. */
  totalDurationMs: number;
}

/**
 * Pre-compute step start times and total duration from step definitions
 * and an optional narration manifest.
 *
 * Step N+1 starts after `max(steps[N+1].delayMs, manifest.steps[N].durationMs)` —
 * whichever is longer, the base delay or the narration clip for the current step.
 *
 * Shared between browser ScenarioPlayer (progress bar) and Remotion
 * video export (frame-based timeline).
 */
export function computeStepTimeline(
  steps: readonly StepTiming[],
  manifest: NarrationManifest | null | undefined,
): StepTimeline {
  const stepStartTimesMs: number[] = [0];

  for (let i = 1; i < steps.length; i++) {
    const prevStart = stepStartTimesMs[i - 1];
    const baseDelay = steps[i].delayMs;
    const narrationMs = manifest?.steps[i - 1]?.durationMs ?? 0;
    stepStartTimesMs.push(prevStart + Math.max(baseDelay, narrationMs));
  }

  const lastStepStart = stepStartTimesMs[stepStartTimesMs.length - 1];
  const lastNarrationMs =
    manifest?.steps[steps.length - 1]?.durationMs ?? 0;
  const totalDurationMs =
    lastStepStart + Math.max(FINAL_DWELL_MS, lastNarrationMs);

  return { stepStartTimesMs, totalDurationMs };
}
