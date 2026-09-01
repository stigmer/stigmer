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

/**
 * How a cut renders: real footage, a styled data panel, a brand motion
 * graphic (resolved via the graphics registry), or a slate awaiting its
 * asset.
 */
export type CutKind = "recording" | "yaml-panel" | "terminal" | "graphic" | "slate";

/**
 * One editorial cut inside a scene. Cut timing is hand-tuned editorial
 * data (the narration pipeline stores no word timestamps — regenerating
 * audio for alignment would invalidate the cached presenter clips), so
 * offsets live here in the manifest, the film's single source of truth.
 */
export interface Cut {
  /**
   * Shot id — for recordings, the assets/recordings/<shot>.webm take;
   * for graphics, the id looked up in the graphics registry.
   */
  shot: string;
  kind: CutKind;
  /** Cut point, seconds from scene start; runs until the next cut. */
  atSec: number;
  /** Trim: where in the source take this cut begins (skips nav prefix). */
  srcStartSec?: number;
}

/**
 * A timed graphic composited ABOVE a scene's base visual — how a motion
 * graphic shares the frame with a presenter clip instead of replacing it
 * (S1b's logo reveal plays over the presenter; S6b's end card takes over
 * after her close). Same hand-tuned-offset doctrine as cuts.
 */
export interface Overlay {
  /** Graphic id, looked up in the graphics registry. */
  graphic: string;
  /** Entry point, seconds from scene start. */
  atSec: number;
  /** How long the overlay plays; omitted = until the scene ends. */
  durationSec?: number;
}

export interface Scene {
  id: string;
  mode: SceneMode;
  /** Narration text, spoken by the one film voice. */
  narration: string;
  /** Planned length until generated narration durations override at render time. */
  plannedDurationSec: number;
  /** Shot plan, mirrored from the approved shot list (S-numbers). */
  shots: string;
  /** Editorial cuts; scenes without cuts render the placeholder slate. */
  cuts?: Cut[];
  /** Timed graphics composited above the scene's base visual. */
  overlays?: Overlay[];
  /**
   * Extra seconds after the narration ends before the next scene — room
   * for a beat that outlives the voice (the S6b end card holds while the
   * music resolves).
   */
  holdSec?: number;
}

export const FPS: number = manifest.fps;
export const WIDTH: number = manifest.width;
export const HEIGHT: number = manifest.height;

/** ElevenLabs premade voice cast at the owner casting gate ("Sarah"). */
export const VOICE_ID: string = manifest.voiceId;

export const SCENES: Scene[] = manifest.scenes as Scene[];

export const plannedDurationInFrames = (scene: Scene): number =>
  Math.round(scene.plannedDurationSec * FPS);
