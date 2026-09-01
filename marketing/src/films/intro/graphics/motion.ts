import { interpolate, spring } from "remotion";

/**
 * The film's motion language, shared by every brand graphic so six scenes
 * read as one design system. Two rules: entrances are critically-damped
 * springs (confident, no bounce — the Linear-style register the script
 * gate approved), and exits are short linear fades (the cut takes the
 * energy, not the outgoing element).
 */

/** Critically damped — settles fast with zero overshoot. The default. */
export const EASE_CONFIDENT = { damping: 200, stiffness: 120, mass: 1 } as const;

/** Slower settle for large set pieces (full-frame reveals, morphs). */
export const EASE_GRAND = { damping: 200, stiffness: 40, mass: 1 } as const;

/** Type scale (px at 1080p). One scale for every graphic. */
export const TYPE = {
  /** The oversized index numerals on title cards ("01"). */
  index: 260,
  display: 112,
  headline: 72,
  title: 44,
  body: 30,
  caption: 22,
} as const;

/** Baseline spacing unit; graphics lay out on multiples of it. */
export const GRID = 8;

/**
 * Spring-driven entrance progress, 0→1. `delay` staggers siblings —
 * the film staggers list items ~4 frames apart.
 */
export const enter = (frame: number, fps: number, delay = 0, config = EASE_CONFIDENT): number =>
  spring({ frame: frame - delay, fps, config });

/** The standard entrance: fade in while rising `distance` px. */
export const fadeUp = (progress: number, distance = 4 * GRID) => ({
  opacity: progress,
  transform: `translateY(${(1 - progress) * distance}px)`,
});

/**
 * Exit fade over the graphic's final `fadeFrames`. Multiplied into a
 * container's opacity so a cut never pops an element off mid-frame.
 */
export const exitFade = (frame: number, durationInFrames: number, fadeFrames = 8): number =>
  interpolate(frame, [durationInFrames - fadeFrames, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
