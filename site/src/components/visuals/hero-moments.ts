/**
 * The homepage hero's five moments, as data: for each hard part, the worry
 * it answers, the line that says what its picture shows, the picture's
 * description for a reader who cannot see it, and how long the hero stays
 * on it before it moves on by itself.
 *
 * Every moment is a real screen of the product the visual suite draws
 * (test/visual/src/scenes/story.tsx): the report the agent wrote in its own
 * computer, handed back; two hours into a year's reconciliation; the ask
 * before a correction is posted; two customers' conversations, each in its
 * own books; the integrator's console, with the models on its own keys.
 *
 * The hero shows the problem and then the solution: the worry, as the
 * section below says it (brand/agent-gets.ts, its one home), over the line
 * that says what the picture proves. The section below keeps the proofs.
 *
 * The hero opens on the ask and, unless the visitor asked for less motion,
 * moves to the next moment in the five's order after `MOMENT_SECONDS`,
 * round to the ask again. The visitor sets the pace: pointing at the hero
 * or focusing inside it holds the moment, and choosing a moment stops the
 * stepping (HeroMoments.tsx).
 */
import { AGENT_GET_IDS, AGENT_GETS, type AgentGetId } from "@/lib/agent-gets";
import { HERO_BASE, HERO_SCREENS } from "@/lib/hero-moments";
import { AGENT_GET_CLAIMS } from "../../../../brand/agent-gets";

export { HERO_BASE, HERO_SCREENS };

/** The hero's attribute: `data-hero-moments`. */
export const ATTRIBUTE = "hero-moments";

/** One moment as the hero shows it. */
export interface HeroMoment {
  /** What the picture shows, for a reader who cannot see it; true of both crops. */
  readonly alt: string;
  /** What the picture proves, said under the worry it answers. */
  readonly answer: string;
}

/** Each hard part's moment, keyed by the five's ids. */
export const HERO_MOMENTS = {
  "own-computer": {
    alt: "Stigmer's chat panel inside a product, beside Northwind Books' ledger. After Northwind said yes, the agent posted the correction, wrote its variance report in its own outputs folder, and the panel hands back variance-report.md.",
    answer: "It wrote Northwind's variance report in a sandbox of its own, and handed it back.",
  },
  hours: {
    alt: "Stigmer's chat panel inside a product, beside Northwind Books' ledger for the year. The agent is reconciling the year's bank statements month by month: 2 h 14 min in, six of nine months done, reading July's statement.",
    answer: "Two hours into reconciling Northwind's year, six months of nine done.",
  },
  "asks-first": {
    alt: "Stigmer's chat panel inside a product, open beside Northwind Books' ledger. The ledger agent has read the ledger, found the Figma annual plan filed under office supplies, and waits for Approve or Deny before it posts the correction.",
    answer: "It stops before it posts a correction to Northwind's ledger.",
  },
  walls: {
    alt: "Two windows of one product, one for Northwind Books and one for Fernhill Bakery. Each asked the same agent to review its quarter, and each answer comes from its own books.",
    answer: "One agent, two customers: each conversation stays in its own customer's books.",
  },
  keys: {
    alt: "Stigmer's console for the company that built the product, on Models & providers: Anthropic and OpenAI both connected on the company's own keys.",
    answer: "In your Stigmer console, every model runs on your own provider key.",
  },
} as const satisfies Readonly<Record<AgentGetId, HeroMoment>>;

/** Each moment's name, as every list of the five says it. */
export function momentName(id: AgentGetId): string {
  return AGENT_GETS[id].title;
}

/** The worry each moment answers, as the section below says it. */
export function momentWorry(id: AgentGetId): string {
  return AGENT_GET_CLAIMS[id].worry;
}

/** Where each moment's row is, in the section below that says it with its proof. */
export function proofHref(id: AgentGetId): `#hard-parts-${AgentGetId}` {
  return `#hard-parts-${id}`;
}

/** The moment after `id` in the five's order, round from the last to the first. */
export function nextMoment(id: AgentGetId): AgentGetId {
  return AGENT_GET_IDS[(AGENT_GET_IDS.indexOf(id) + 1) % AGENT_GET_IDS.length];
}

/**
 * How long the hero stays on a moment before it moves on by itself: long
 * enough to read the worry and the answer (about twenty words) and then
 * find in the picture what the answer points at.
 */
export const MOMENT_SECONDS = 10;

/** The cross-fade between two moments' pictures. */
export const FADE_SECONDS = 0.6;

/**
 * The hero's stylesheet: the line under the lit name filling for the
 * moment's time, held while the visitor points at or focuses in the hero,
 * and the pictures' cross-fade. It holds no quote, `<`, `>` or `&`, so no
 * escaping can change it on its way into the page.
 */
export const HERO_CSS = [
  `@keyframes ${ATTRIBUTE}-progress{from{transform:scaleX(0)}to{transform:scaleX(1)}}`,
  `[data-${ATTRIBUTE}-progress]{transform-origin:left;animation:${ATTRIBUTE}-progress ${MOMENT_SECONDS}s linear both}`,
  `[data-${ATTRIBUTE}][data-held=true] [data-${ATTRIBUTE}-progress]{animation-play-state:paused}`,
  `[data-${ATTRIBUTE}-picture]{transition:opacity ${FADE_SECONDS}s ease}`,
].join("\n");
