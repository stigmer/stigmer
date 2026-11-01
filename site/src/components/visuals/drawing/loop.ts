/**
 * The loop engine the site's moving pictures share: a table of parts and a
 * timeline become CSS keyframes that walk a light through the picture, step
 * by step, and settle on the finished picture.
 *
 * Each part says when it first shows (and, for a file handed on, when it
 * goes), at which steps it is lit, and whether it is lit in the finished
 * picture. The loop animates opacity only, so it costs the page no restyle
 * or repaint: a part's resting look is drawn once, and its lit look sits over
 * it on layers that fade in, each marked by its own attribute (`data-part`,
 * `data-ring`, `data-ink`, `data-stroke`).
 *
 * The finished picture holds across the loop's seam (from `settles` round to
 * `clears`), and every animation runs with fill mode `both` and no delay, so
 * the site's reduced-motion block, which lands every animation on its last
 * frame, shows the finished picture still. The stylesheet hides the pause
 * button then too.
 */

export type Layer = "ring" | "ink" | "stroke";

export interface LoopPart<S extends string> {
  /** The step it first shows at; a part that is the stage always shows. */
  shows: S | "always";
  /** The step it goes at, handed on; a part with none stays to the finished picture. */
  hides?: S;
  /** The steps it is lit at. */
  lit: readonly S[];
  /** Whether it is lit in the finished picture. */
  litAtHold: boolean;
  /** The layers it lights with, besides its own. */
  layers: readonly Layer[];
}

/** The finished picture, the stage with the story cleared, or a step of it. */
export type Moment<S extends string> = "hold" | "clear" | S;

/** Where things happen in the cycle, in percent of it. */
export interface Timeline<S extends string> {
  cycleSeconds: number;
  rampSeconds: number;
  clears: number;
  steps: Readonly<Record<S, number>>;
  settles: number;
}

/** Each layer's opacity at rest and lit (for `part`: hidden and shown). */
export type Opacity = Readonly<Record<Layer | "part", { readonly off: number; readonly on: number }>>;

export interface Loop<S extends string, P extends string> {
  /** Names the figure's attribute, its cycle's custom property and its keyframes. */
  prefix: string;
  steps: readonly S[];
  parts: Readonly<Record<P, LoopPart<S>>>;
  timeline: Timeline<S>;
  opacity: Opacity;
}

/** The attribute that marks each layer in the markup. */
export const LAYER_ATTRIBUTE = {
  part: "data-part",
  ring: "data-ring",
  ink: "data-ink",
  stroke: "data-stroke",
} as const satisfies Record<Layer | "part", string>;

/** The layers a part animates: its own, unless it always shows, and its lit layers. */
export function layersOf<S extends string>(part: LoopPart<S>): (Layer | "part")[] {
  return part.shows === "always" ? [...part.layers] : ["part", ...part.layers];
}

/** Whether a layer of a part is on at a moment: the part shown, or the layer lit. */
export function isOn<S extends string>(
  steps: readonly S[],
  part: LoopPart<S>,
  layer: Layer | "part",
  moment: Moment<S>,
): boolean {
  if (layer === "part") {
    if (part.shows === "always") return true;
    if (moment === "hold") return part.hides === undefined;
    if (moment === "clear") return false;
    const at = steps.indexOf(moment);
    return steps.indexOf(part.shows) <= at && (part.hides === undefined || at < steps.indexOf(part.hides));
  }
  if (moment === "hold") return part.litAtHold;
  return moment !== "clear" && part.lit.includes(moment);
}

/** The keyframes of one layer: held between changes, each change a short ramp. */
function keyframes<S extends string, P extends string>(loop: Loop<S, P>, part: LoopPart<S>, layer: Layer | "part"): string {
  const { timeline } = loop;
  const value = (moment: Moment<S>) => loop.opacity[layer][isOn(loop.steps, part, layer, moment) ? "on" : "off"];
  const ramp = (timeline.rampSeconds / timeline.cycleSeconds) * 100;
  const changes: [number, Moment<S>][] = [
    [timeline.clears, "clear"],
    ...loop.steps.map((step): [number, Moment<S>] => [timeline.steps[step], step]),
    [timeline.settles, "hold"],
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

/**
 * The loop's stylesheet: every layer's keyframes and rule, the pause, and the
 * pause button hidden when the visitor asked for less motion.
 *
 * It holds no quote, `<`, `>` or `&`, so no escaping can change it on its
 * way into the page.
 */
export function loopCss<S extends string, P extends string>(loop: Loop<S, P>): string {
  const { prefix } = loop;
  const rules = [`[data-${prefix}]{--${prefix}-cycle:${loop.timeline.cycleSeconds}s}`];
  for (const [id, part] of Object.entries(loop.parts) as [P, LoopPart<S>][]) {
    for (const layer of layersOf(part)) {
      const name = `${prefix}-${layer}-${id}`;
      const resting = loop.opacity[layer][isOn(loop.steps, part, layer, "hold") ? "on" : "off"];
      rules.push(
        `@keyframes ${name}{${keyframes(loop, part, layer)}}`,
        `[data-${prefix}] [${LAYER_ATTRIBUTE[layer]}=${id}]{opacity:${resting};animation:${name} var(--${prefix}-cycle) linear infinite both}`,
      );
    }
  }
  const animated = Object.values(LAYER_ATTRIBUTE).map((attribute) => `[data-${prefix}][data-paused=true] [${attribute}]`);
  rules.push(
    `${animated.join(",")}{animation-play-state:paused}`,
    `@media (prefers-reduced-motion:reduce){[data-${prefix}-pause]{display:none}}`,
  );
  return rules.join("\n");
}
