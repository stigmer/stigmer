/**
 * The job every picture of Stigmer at work tells, as data: a customer inside
 * your product hands its agent a ledger; the agent takes it into its own
 * computer, works through it, stops to ask before it posts an adjustment,
 * gets a yes, and hands back a report.
 *
 * `PARTS` says when each part of the picture first shows and when it is lit,
 * and `isOn` turns a part, a layer and a moment into on or off. The homepage
 * hero's loop (site/src/components/visuals/job-path.ts) and the job film
 * (marketing/src/films/job/) both read them, so the two light the same parts
 * at the same steps; only their clocks differ. Each part lights on layers
 * named for itself, so lighting the computer never brightens the parts drawn
 * inside it:
 *
 * - `part`: the part itself, hidden until its step.
 * - `ring`: a bright border over the resting one.
 * - `ink`: its words and icon, drawn bright and dimmed to the resting grey
 *   (0.64 of #f5f5f5 over the site's near-black grounds is about #a3a3a3).
 * - `stroke`: an arrow or rule, dimmed to the resting border grey
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

/** The finished picture, the stage with the story cleared, or a step of it. */
export type Moment = "hold" | "clear" | Step;

/** Each layer's opacity at rest and lit (for `part`: hidden and shown). */
export const OPACITY = {
  part: { off: 0, on: 1 },
  ring: { off: 0, on: 1 },
  ink: { off: 0.64, on: 1 },
  stroke: { off: 0.3, on: 1 },
} as const satisfies Record<Layer | "part", { off: number; on: number }>;

/** Whether a layer of a part is on at a moment: the part shown, or the layer lit. */
export function isOn(part: Part, layer: Layer | "part", moment: Moment): boolean {
  if (layer === "part") {
    if (part.shows === "always" || moment === "hold") return true;
    return moment !== "clear" && STEPS.indexOf(part.shows) <= STEPS.indexOf(moment);
  }
  if (moment === "hold") return part.litAtHold;
  return moment !== "clear" && part.lit.includes(moment);
}
