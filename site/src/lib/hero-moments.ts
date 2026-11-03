/**
 * The homepage hero's pictures, by the five's ids: one moment of the product
 * per hard part, each a whole screen and its phone crop from the visual
 * suite's shown list (test/visual/src/shown.ts).
 *
 * The names alone live here, apart from the hero's words and its loop
 * (components/visuals/hero-moments.ts), so the screens build
 * (scripts/generate-screens.ts) can weigh the hero's files as one set
 * without loading a component. The map is typed by the five's ids, so a
 * sixth hard part, or an id renamed in brand/agent-gets.ts, fails the
 * typecheck rather than leaving a name with no moment.
 */
import type { AgentGetId } from "./agent-gets";

/** One moment's pictures: the whole screen, and its crop below the crop breakpoint. */
export interface HeroScreens {
  readonly whole: string;
  readonly narrow: string;
}

/** Each hard part's moment. The ask is M8's picture, kept under its own names. */
export const HERO_SCREENS = {
  "own-computer": { whole: "own-computer", narrow: "own-computer-panel" },
  hours: { whole: "hours", narrow: "hours-panel" },
  "asks-first": { whole: "in-product", narrow: "in-product-panel" },
  walls: { whole: "walls", narrow: "walls-panel" },
  keys: { whole: "keys", narrow: "keys-panel" },
} as const satisfies Readonly<Record<AgentGetId, HeroScreens>>;

/**
 * The moment always beneath the others: the first frame, the page's largest
 * paint, and the still a visitor who asked for less motion sees.
 */
export const HERO_BASE = "asks-first" satisfies AgentGetId;

/**
 * The hero's files as a visit fetches them: one crop at one density, so the
 * whole pictures and the crops are each one set, weighed at each density.
 */
export const HERO_SETS = [
  { crop: "whole", names: Object.values(HERO_SCREENS).map((screens) => screens.whole) },
  { crop: "narrow", names: Object.values(HERO_SCREENS).map((screens) => screens.narrow) },
] as const;
