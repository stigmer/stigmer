/**
 * The homepage hero's five moments, as data: what each picture shows, for a
 * reader who cannot see it, its one-line caption, and the walk that steps
 * through them.
 *
 * Every moment is a real screen of the product the visual suite draws
 * (test/visual/src/scenes/story.tsx): the report the agent wrote in its own
 * computer, handed back; two hours into a year's reconciliation; the ask
 * before a correction is posted; two customers' conversations, each in its
 * own books; the integrator's console, with the models on its own keys. A
 * caption says what the picture shows, never the claim's own line, which
 * the section below (HardParts) says with its proof.
 *
 * The walk (`drawing/loop.ts`) opens on the ask, which is always beneath
 * the others, steps through the other four and back to it. Each of those
 * shows at its step and goes at the next, so one moment cross-fades into
 * the next. The walk clears the ask's lit name one ramp before the first
 * step, so no stretch longer than one ramp lights no name. Every animation
 * lands on the finished picture, the ask with its name lit, when the
 * visitor asked for less motion, and the ask holds for a third of the
 * cycle, as every looping picture's finished picture does
 * (`@/__test-utils__/loop-checks`).
 */
import { AGENT_GETS, type AgentGetId } from "@/lib/agent-gets";
import { HERO_BASE, HERO_SCREENS } from "@/lib/hero-moments";
import { loopCss, type Loop, type LoopPart, type Opacity, type Timeline } from "./drawing/loop";

export { HERO_BASE, HERO_SCREENS };

/** The figure's attribute: `data-hero-moments`. */
export const ATTRIBUTE = "hero-moments";

/** One moment as the hero shows it. */
export interface HeroMoment {
  /** What the picture shows, for a reader who cannot see it; true of both crops. */
  readonly alt: string;
  /** The line under the five names while the moment is on screen. */
  readonly caption: string;
}

/** Each hard part's moment, keyed by the five's ids. */
export const HERO_MOMENTS = {
  "own-computer": {
    alt: "Stigmer's chat panel inside a product, beside Northwind Books' ledger. After Northwind said yes, the agent posted the correction, wrote its variance report in its own outputs folder, and the panel hands back variance-report.md.",
    caption: "It wrote Northwind's variance report in a sandbox of its own, and handed it back.",
  },
  hours: {
    alt: "Stigmer's chat panel inside a product, beside Northwind Books' ledger for the year. The agent is reconciling the year's bank statements month by month: 2 h 14 min in, six of nine months done, reading July's statement.",
    caption: "Two hours into reconciling Northwind's year, six months of nine done.",
  },
  "asks-first": {
    alt: "Stigmer's chat panel inside a product, open beside Northwind Books' ledger. The ledger agent has read the ledger, found the Figma annual plan filed under office supplies, and waits for Approve or Deny before it posts the correction.",
    caption: "It stops before it posts a correction to Northwind's ledger.",
  },
  walls: {
    alt: "Two windows of one product, one for Northwind Books and one for Fernhill Bakery. Each asked the same agent to review its quarter, and each answer comes from its own books.",
    caption: "One agent, two customers: each conversation stays in its own customer's books.",
  },
  keys: {
    alt: "Stigmer's console for the company that built the product, on Models & providers: Anthropic and OpenAI both connected on the company's own keys.",
    caption: "In your Stigmer console, every model runs on your own provider key.",
  },
} as const satisfies Readonly<Record<AgentGetId, HeroMoment>>;

/** Each moment's name, as every list of the five says it. */
export function momentName(id: AgentGetId): string {
  return AGENT_GETS[id].title;
}

/** The walk, in order: the four over the ask, then the ask, which holds across the seam. */
export const WALK = ["walls", "keys", "own-computer", "hours", HERO_BASE] as const satisfies readonly AgentGetId[];

export type Step = (typeof WALK)[number];

/** Each moment shows at its own step and goes at the next; the ask shows at the last and stays. */
export const PARTS = Object.fromEntries(
  WALK.map((id, index) => {
    const next = WALK[index + 1];
    const part: LoopPart<Step> = next === undefined
      ? { shows: id, lit: [], litAtHold: false, layers: [] }
      : { shows: id, hides: next, lit: [], litAtHold: false, layers: [] };
    return [id, part];
  }),
) as Readonly<Record<Step, LoopPart<Step>>>;

/** How long each moment is on screen. */
const MOMENT_SECONDS = 4.5;

/**
 * How long the ask holds before the walk starts, beyond its own moment at
 * the walk's end: enough for a third of the cycle, and a cycle of 30 s, so
 * every point of it is a whole percent.
 */
const HOLD_SECONDS = 7.5;

/** Each cross-fade. */
const RAMP_SECONDS = 0.6;

/** The cycle: the ask held, then each of the five for a moment's time. */
const CYCLE_SECONDS = HOLD_SECONDS + MOMENT_SECONDS * WALK.length;

/** When a step of the walk starts, in seconds. */
function stepStart(index: number): number {
  return HOLD_SECONDS + MOMENT_SECONDS * index;
}

/** A time in the cycle, in percent of it. */
function at(seconds: number): number {
  return Number(((seconds / CYCLE_SECONDS) * 100).toFixed(3));
}

/**
 * Where things happen in the cycle, in percent: the ask held, then a step
 * every moment's time, each a cross-fade. The walk clears one ramp before
 * its first step, so the ask's lit name fades as the first moment's comes;
 * it settles once the ask is back, with room for its ramp.
 */
export const TIMELINE = {
  cycleSeconds: CYCLE_SECONDS,
  rampSeconds: RAMP_SECONDS,
  clears: at(stepStart(0) - RAMP_SECONDS),
  steps: Object.fromEntries(WALK.map((id, index) => [id, at(stepStart(index))])) as Readonly<Record<Step, number>>,
  settles: at(stepStart(WALK.length - 1) + 1.5 * RAMP_SECONDS),
} as const satisfies Timeline<Step>;

/** A moment is shown or not: only its own layer moves. */
export const OPACITY = {
  part: { off: 0, on: 1 },
  ring: { off: 0, on: 1 },
  ink: { off: 0, on: 1 },
  stroke: { off: 0, on: 1 },
} as const satisfies Opacity;

export const LOOP = {
  prefix: ATTRIBUTE,
  steps: WALK,
  parts: PARTS,
  timeline: TIMELINE,
  opacity: OPACITY,
} as const satisfies Loop<Step, Step>;

/** The loop's stylesheet. */
export const LOOP_CSS = loopCss(LOOP);

/** Where the five names point: each one's row in the section below, which says it with its proof. */
export function proofHref(id: AgentGetId): `#hard-parts-${AgentGetId}` {
  return `#hard-parts-${id}`;
}

/** The link after the picture, to the section that says all five. */
export const HERO_LINK = { text: "See how Stigmer handles each one", href: "#hard-parts" } as const;
