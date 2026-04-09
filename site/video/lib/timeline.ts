import type { NarrationManifest } from "@/components/docs/demos/engine/narration";
import { computeStepTimeline } from "@/components/docs/demos/engine/timeline";

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

function msToFrames(ms: number, fps: number): number {
  return Math.round((ms * fps) / 1000);
}

/**
 * Pre-compute a deterministic playback timeline with Remotion frame
 * offsets. Delegates ms-level computation to the shared
 * {@link computeStepTimeline} utility.
 */
export function computeTimeline(
  steps: readonly StepTiming[],
  manifest: NarrationManifest | null,
  fps: number,
): Timeline {
  const { stepStartTimesMs, totalDurationMs } = computeStepTimeline(steps, manifest);

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
