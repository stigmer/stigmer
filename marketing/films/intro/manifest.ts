/**
 * Typed view over manifest.json — the single source of truth for the Intro to
 * Stigmer film. The narration pipeline (scripts/narrate.mjs) reads the JSON
 * directly; the composition imports this module. One file feeds both, so the
 * script can never drift between audio and picture. The prose was approved at
 * the owner script gate on 2026-09-02 (stigmer-cloud project
 * 20260902.01.stigmer-intro-video, script v1).
 */
import manifest from "./manifest.json";

export type SceneMode = "presenter" | "vo";

export interface Scene {
  id: string;
  mode: SceneMode;
  /** Narration text, spoken by the one film voice. */
  narration: string;
  /** Planned length until generated narration durations override at render time. */
  plannedDurationSec: number;
  /** Shot plan, mirrored from the approved shot list (S-numbers). */
  shots: string;
}

export const FPS: number = manifest.fps;
export const WIDTH: number = manifest.width;
export const HEIGHT: number = manifest.height;

/** ElevenLabs premade voice cast at the owner casting gate ("Sarah"). */
export const VOICE_ID: string = manifest.voiceId;

export const SCENES: Scene[] = manifest.scenes as Scene[];

export const plannedDurationInFrames = (scene: Scene): number =>
  Math.round(scene.plannedDurationSec * FPS);
