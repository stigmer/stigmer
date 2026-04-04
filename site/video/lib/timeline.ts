import type { NarrationManifest } from "@/components/docs/demos/engine/narration";

/**
 * Minimal step shape — only the timing field is needed for timeline
 * computation. Accepts any ScenarioStep<T> without caring about data.
 */
interface StepTiming {
  delayMs: number;
}

export interface AudioClip {
  stepIndex: number;
  /** Asset path from the narration manifest (e.g. "/demos/foo/step-0.mp3"). */
  src: string;
  startFrame: number;
  durationFrames: number;
}

export interface Timeline {
  /** Start time of each step in milliseconds (index 0 is always 0). */
  stepStartTimesMs: number[];
  /** Start frame of each step (for Remotion Sequence positioning). */
  stepStartFrames: number[];
  /** Narration audio clips with frame offsets for Remotion Audio. */
  audioClips: AudioClip[];
  totalDurationMs: number;
  totalFrames: number;
}

/** Dwell time on the final step so viewers can absorb the result. */
const FINAL_DWELL_MS = 3_000;

function msToFrames(ms: number, fps: number): number {
  return Math.round((ms * fps) / 1000);
}

/**
 * Pre-compute a deterministic playback timeline from step definitions
 * and an optional narration manifest.
 *
 * The timing model matches ScenarioPlayer's unmuted auto-advance
 * logic: step N+1 appears after `max(steps[N+1].delayMs,
 * manifest.steps[N].durationMs)` — whichever is longer, the base
 * delay or the narration clip for the current step.
 */
export function computeTimeline(
  steps: readonly StepTiming[],
  manifest: NarrationManifest | null,
  fps: number,
): Timeline {
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

  const stepStartFrames = stepStartTimesMs.map((ms) => msToFrames(ms, fps));
  const totalFrames = msToFrames(totalDurationMs, fps);

  const audioClips: AudioClip[] = [];
  if (manifest) {
    for (let i = 0; i < manifest.steps.length; i++) {
      const entry = manifest.steps[i];
      if (!entry) continue;
      audioClips.push({
        stepIndex: i,
        src: entry.src,
        startFrame: stepStartFrames[i],
        durationFrames: msToFrames(entry.durationMs, fps),
      });
    }
  }

  return {
    stepStartTimesMs,
    stepStartFrames,
    audioClips,
    totalDurationMs,
    totalFrames,
  };
}
