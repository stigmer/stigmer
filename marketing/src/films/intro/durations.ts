import { FPS, SCENES, plannedDurationInFrames } from "../../../films/intro/manifest";

/**
 * Narration manifest written by scripts/narrate.mjs: scene id → exact audio
 * duration in milliseconds (ElevenLabs with-timestamps is millisecond-exact).
 */
export type NarrationManifest = Record<string, { durationMs: number }>;

const TAIL_PADDING_FRAMES = 12; // breathing room after each narration line

/**
 * Frame durations per scene: exact narration length when audio exists,
 * the manifest's planned duration otherwise. THE one timing derivation —
 * composition length and per-scene sequences must both come from here.
 */
export const sceneDurations = (narration: NarrationManifest | null): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const scene of SCENES) {
    const gen = narration?.[scene.id];
    out[scene.id] = gen
      ? Math.ceil((gen.durationMs / 1000) * FPS) + TAIL_PADDING_FRAMES
      : plannedDurationInFrames(scene);
  }
  return out;
};

export const totalDuration = (narration: NarrationManifest | null): number =>
  Object.values(sceneDurations(narration)).reduce((a, b) => a + b, 0);
