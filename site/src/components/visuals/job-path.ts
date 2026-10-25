/**
 * The loop that plays the hero's picture of the job.
 *
 * The job itself (its names, its steps, the parts of the picture and the rule
 * for when each is shown and lit) is brand/job-story.ts, which the job film in
 * marketing/ reads too; it is re-exported here for the picture. `jobPathCss`
 * turns that table into the loop's keyframes, so a step added is a line
 * there, never a set of hand-kept percentage lists.
 *
 * The loop animates opacity only, so it costs the page no restyle or repaint:
 * a part's resting look is drawn once, and its lit look sits over it on
 * layers that fade in (brand/job-story.ts names them). Each is marked by its
 * own attribute: `data-part`, `data-ring`, `data-ink` and `data-stroke`.
 */
import { OPACITY, PARTS, STEPS, isOn, type Layer, type Moment, type Part, type PartId, type Step } from "../../../../brand/job-story";

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
} as const satisfies {
  cycleSeconds: number;
  rampSeconds: number;
  clears: number;
  steps: Record<Step, number>;
  settles: number;
};

/** The keyframes of one layer: held between changes, each change a short ramp. */
function keyframes(part: Part, layer: Layer | "part"): string {
  const value = (moment: Moment) => OPACITY[layer][isOn(part, layer, moment) ? "on" : "off"];
  const ramp = (TIMELINE.rampSeconds / TIMELINE.cycleSeconds) * 100;
  const changes: [number, Moment][] = [
    [TIMELINE.clears, "clear"],
    ...STEPS.map((step): [number, Moment] => [TIMELINE.steps[step], step]),
    [TIMELINE.settles, "hold"],
  ];
  const hold = value("hold");
  const frames = [`0%{opacity:${hold}}`];
  let previous = hold;
  for (const [at, moment] of changes) {
    const next = value(moment);
    if (next === previous) continue;
    frames.push(`${at}%{opacity:${previous}}`, `${Number((at + ramp).toFixed(3))}%{opacity:${next}}`);
    previous = next;
  }
  frames.push(`100%{opacity:${hold}}`);
  return frames.join("");
}

const ATTRIBUTE = { part: "data-part", ring: "data-ring", ink: "data-ink", stroke: "data-stroke" } as const;

/**
 * The picture's stylesheet: every layer's keyframes and rule, the pause, and
 * the pause button hidden when the visitor asked for less motion (the site's
 * reduced-motion block lands every animation on its last frame, the finished
 * picture, because each runs with fill mode `both` and no delay).
 *
 * It holds no quote, `<`, `>` or `&`, so no escaping can change it on its
 * way into the page.
 */
export function jobPathCss(): string {
  const rules = [`[data-job-path]{--job-path-cycle:${TIMELINE.cycleSeconds}s}`];
  for (const [id, part] of Object.entries(PARTS) as [PartId, Part][]) {
    const layers: (Layer | "part")[] = part.shows === "always" ? [...part.layers] : ["part", ...part.layers];
    for (const layer of layers) {
      const name = `job-path-${layer}-${id}`;
      rules.push(
        `@keyframes ${name}{${keyframes(part, layer)}}`,
        `[data-job-path] [${ATTRIBUTE[layer]}=${id}]{opacity:${OPACITY[layer][isOn(part, layer, "hold") ? "on" : "off"]};animation:${name} var(--job-path-cycle) linear infinite both}`,
      );
    }
  }
  const animated = Object.values(ATTRIBUTE).map((attribute) => `[data-job-path][data-paused=true] [${attribute}]`);
  rules.push(
    `${animated.join(",")}{animation-play-state:paused}`,
    `@media (prefers-reduced-motion:reduce){[data-job-path-pause]{display:none}}`,
  );
  return rules.join("\n");
}
