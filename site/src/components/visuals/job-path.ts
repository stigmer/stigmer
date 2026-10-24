/**
 * The job the hero's picture tells, as data, and the loop that plays it.
 *
 * A customer inside your product hands its agent a ledger; the agent takes it
 * into its own computer, works through it, stops to ask before it posts an
 * adjustment, gets a yes, and hands back a report. `PARTS` says when each
 * part of the picture first shows and when it is lit; `jobPathCss` turns that
 * table into the loop's keyframes, so a step added is a line here, never a
 * set of hand-kept percentage lists.
 *
 * The loop animates opacity only, so it costs the page no restyle or repaint:
 * a part's resting look is drawn once, and its lit look sits over it on
 * layers that fade in. Each layer is named for its own part, so lighting the
 * computer never brightens the parts drawn inside it:
 *
 * - `data-part`: the part itself, hidden until its step.
 * - `data-ring`: a bright border over the resting one.
 * - `data-ink`: its words and icon, drawn bright and dimmed to the resting
 *   grey (0.64 of #f5f5f5 over the site's near-black grounds is about #a3a3a3).
 * - `data-stroke`: an arrow or rule, dimmed to the resting border grey
 *   (0.3 of #f5f5f5 over #0a0a0a is about #4f4f4f).
 */

/** The job's names, as the Getting Started pages and the approval-flows page spell them. */
export const JOB = {
  customer: "Northwind Books",
  agent: "variance-reporter",
  ledger: "ledger.csv",
  message: "Review this quarter's ledger.",
  tool: "post_adjustment",
  report: "variance-report.md",
} as const;

/** The story, in order. */
export const STEPS = ["hands-over", "enters", "works", "asks", "approves", "returns"] as const;

export type Step = (typeof STEPS)[number];

export type Layer = "ring" | "ink" | "stroke";

export interface Part {
  /** The step it first shows at; the computer is the stage and always shows. */
  shows: Step | "always";
  /** The steps it is lit at. */
  lit: readonly Step[];
  /** Whether it is lit in the finished picture. */
  litAtHold: boolean;
  /** The layers it lights with, besides its own. */
  layers: readonly Layer[];
}

export const PARTS = {
  "customer-ledger": { shows: "hands-over", lit: ["hands-over"], litAtHold: false, layers: ["ring", "ink"] },
  "arrow-in": { shows: "hands-over", lit: ["hands-over", "enters"], litAtHold: false, layers: ["stroke"] },
  "computer-ledger": { shows: "enters", lit: ["enters"], litAtHold: false, layers: ["ring", "ink"] },
  computer: { shows: "always", lit: ["enters", "works"], litAtHold: true, layers: ["ring", "ink"] },
  "computer-work": { shows: "works", lit: ["works"], litAtHold: false, layers: ["ink", "stroke"] },
  "computer-ask": { shows: "asks", lit: ["asks", "approves"], litAtHold: false, layers: ["ring", "ink"] },
  "arrow-ask": { shows: "asks", lit: ["asks", "approves"], litAtHold: false, layers: ["stroke"] },
  "customer-ask": { shows: "asks", lit: ["asks", "approves"], litAtHold: false, layers: ["ring", "ink"] },
  "customer-yes": { shows: "approves", lit: ["approves"], litAtHold: true, layers: ["ring", "ink"] },
  "computer-report": { shows: "returns", lit: ["returns"], litAtHold: false, layers: ["ring", "ink"] },
  "arrow-out": { shows: "returns", lit: ["returns"], litAtHold: false, layers: ["stroke"] },
  "customer-report": { shows: "returns", lit: ["returns"], litAtHold: true, layers: ["ring", "ink"] },
} as const satisfies Record<string, Part>;

export type PartId = keyof typeof PARTS;

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

/** The finished picture, the stage with the story cleared, or a step of it. */
export type Moment = "hold" | "clear" | Step;

/** Each layer's opacity at rest and lit (for `part`: hidden and shown). */
export const OPACITY = {
  part: { off: 0, on: 1 },
  ring: { off: 0, on: 1 },
  ink: { off: 0.64, on: 1 },
  stroke: { off: 0.3, on: 1 },
} as const satisfies Record<Layer | "part", { off: number; on: number }>;

function isOn(part: Part, layer: Layer | "part", moment: Moment): boolean {
  if (layer === "part") {
    if (part.shows === "always" || moment === "hold") return true;
    return moment !== "clear" && STEPS.indexOf(part.shows) <= STEPS.indexOf(moment);
  }
  if (moment === "hold") return part.litAtHold;
  return moment !== "clear" && part.lit.includes(moment);
}

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
