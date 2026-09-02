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
 * A normalized region of the source frame (all values 0..1, origin at the
 * top-left). Camera moves and spotlights target regions, not pixels, so
 * the same editorial data survives any render size.
 */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One camera keyframe on a cut: at `atSec` (seconds from CUT start — a
 * cut's inner choreography must survive the cut point being retimed) the
 * camera begins easing to `zoom`, pushing in around the point of interest
 * (`cx`,`cy`, normalized) over `easeSec`. Keyframes chain in order. Zooms
 * stay modest (≤ ~1.35) — takes are 1080p, so deep zooms go soft; the
 * spotlight carries precision pointing.
 */
export interface CameraMove {
  atSec: number;
  zoom: number;
  cx: number;
  cy: number;
  /** Ease duration into this keyframe; default is a calm ~1.4s. */
  easeSec?: number;
}

/**
 * A timed highlight on a cut: everything but `region` dims, an accent
 * ring lifts the target, an optional label names it. This is the film's
 * "look here" gesture — the answer to a full product frame where the
 * viewer would otherwise hunt for the element the narration means.
 */
export interface Spotlight {
  /** Entry, seconds from CUT start (same rebasing rule as CameraMove). */
  atSec: number;
  durationSec: number;
  region: Region;
  label?: string;
}

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
  /**
   * Cross-dissolve length from the previous cut; omitted = hard cut.
   * The previous cut keeps playing beneath while this one fades in.
   */
  fadeInSec?: number;
  /** Camera keyframes (recording cuts only — panels compose their own motion). */
  camera?: CameraMove[];
  /** Timed highlights, composited inside the camera transform so they track it. */
  spotlights?: Spotlight[];
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

/**
 * The film's music bed spec, consumed by scripts/music.mjs (ElevenLabs
 * Music, generated-not-licensed per the rough-cut gate). The composition
 * itself only checks whether assets/music/bed.mp3 exists.
 */
export interface MusicSpec {
  prompt: string;
  lengthMs: number;
}

export const FPS: number = manifest.fps;
export const WIDTH: number = manifest.width;
export const HEIGHT: number = manifest.height;

/** ElevenLabs premade voice cast at the owner casting gate ("Sarah"). */
export const VOICE_ID: string = manifest.voiceId;

export const MUSIC: MusicSpec = manifest.music;

export const SCENES: Scene[] = manifest.scenes as Scene[];

export const plannedDurationInFrames = (scene: Scene): number =>
  Math.round(scene.plannedDurationSec * FPS);
