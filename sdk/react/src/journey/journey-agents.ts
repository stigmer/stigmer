// Which agents are a newcomer's own, made on the journey: an example's agent
// (the launcher's first question makes it under the example's slug) or one
// described in their own words (`your-agent`, then `your-agent-2` and on, up
// to the tries the first question makes). "Make it yours" is about these
// agents only: an agent a plugin installed gains versions when the plugin
// upgrades, and one made some other way is not the newcomer's first agent,
// so neither ticks the step or draws the journey's lines.
//
// The slugs come from `@stigmer/examples`' slug list, never its full
// catalogue, so a screen that only asks "is this a journey agent?" does not
// download the samples.

import { EXAMPLE_AGENT_SLUGS } from "@stigmer/examples";

/** The slug an agent described in the person's own words is made under, before any number. */
export const OWN_AGENT_SLUG = "your-agent";
/** How many names (`your-agent`, `your-agent-2`, …) a described agent tries before saying so. */
export const OWN_AGENT_TRIES = 10;

/** The slug the `n`th try of a described agent is made under: `your-agent`, then `your-agent-2`. */
export function ownAgentSlug(n: number): string {
  return n === 1 ? OWN_AGENT_SLUG : `${OWN_AGENT_SLUG}-${n}`;
}

/** Whether `slug` is an agent described in the person's own words. */
export function isOwnAgentSlug(slug: string): boolean {
  if (slug === OWN_AGENT_SLUG) return true;
  const match = /^your-agent-(\d+)$/.exec(slug);
  if (match === null) return false;
  const n = Number(match[1]);
  return String(n) === match[1] && n >= 2 && n <= OWN_AGENT_TRIES;
}

/** Whether `slug` is an agent the journey made: an example's, or one described in the person's own words. */
export function isJourneyAgentSlug(slug: string): boolean {
  return EXAMPLE_AGENT_SLUGS.includes(slug) || isOwnAgentSlug(slug);
}
