/**
 * The loop that plays the hero's picture of the job.
 *
 * The job itself (its names, its steps, the parts of the picture and the rule
 * for when each is shown and lit) is brand/job-story.ts, which the job film in
 * marketing/ reads too; it is re-exported here for the picture. `jobPathCss`
 * turns that table into the loop's keyframes through the site's shared loop
 * engine (`drawing/loop.ts`), so a step added is a line there, never a set
 * of hand-kept percentage lists.
 *
 * The loop animates opacity only, so it costs the page no restyle or repaint:
 * a part's resting look is drawn once, and its lit look sits over it on
 * layers that fade in (brand/job-story.ts names them). Each is marked by its
 * own attribute: `data-part`, `data-ring`, `data-ink` and `data-stroke`.
 */
import { JOB, OPACITY, PARTS, STEPS, type PartId, type Step } from "../../../../brand/job-story";
import { loopCss, type Loop, type Timeline } from "./drawing/loop";

export { JOB, OPACITY, PARTS, STEPS, isOn } from "../../../../brand/job-story";
export type { Layer, Moment, Part, PartId, Step } from "../../../../brand/job-story";

/**
 * Where things happen in the cycle, in percent. The finished picture holds
 * across the loop's seam (from `settles` round to `clears`), so a first visit
 * sees the whole job still for about three seconds before it plays.
 */
export const TIMELINE = {
  cycleSeconds: 16,
  rampSeconds: 0.3,
  clears: 18,
  steps: { "hands-over": 21, enters: 32, works: 43, asks: 56, approves: 64, returns: 73 },
  settles: 85,
} as const satisfies Timeline<Step>;

/** The hero's loop, as the shared loop engine reads it. */
export const JOB_PATH_LOOP = {
  prefix: "job-path",
  steps: STEPS,
  parts: PARTS,
  timeline: TIMELINE,
  opacity: OPACITY,
} as const satisfies Loop<Step, PartId>;

/**
 * The picture's stylesheet: every layer's keyframes and rule, the pause, and
 * the pause button hidden when the visitor asked for less motion
 * (`drawing/loop.ts`).
 */
export function jobPathCss(): string {
  return loopCss(JOB_PATH_LOOP);
}

/**
 * The picture's text alternative: its caption for a screen reader, and what
 * the docs' markdown exports carry in its place (`site/src/components/visuals/diagrams.ts`).
 */
export const CAPTION =
  `${JOB.customer}, a customer in your product, hands its agent ${JOB.ledger}. ` +
  `The agent works through it for hours in its own computer, asks before it posts an adjustment, ` +
  `and hands back ${JOB.report}, while every other customer's agent stays behind a wall.`;
