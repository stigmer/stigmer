// Which agents are a newcomer's own, made on the journey: an example's agent
// (the launcher's first question makes it under the example's slug) or one
// described in their own words (`your-agent`, then `your-agent-2` and on, up
// to the tries the first question makes). "Make it yours" is about these
// agents only: an agent a plugin installed gains versions when the plugin
// upgrades, and one made some other way is not the newcomer's first agent,
// so neither ticks the step or draws the journey's lines.
//
// The slugs come from `@stigmer/examples`' slug list. Importing it can bring
// the examples' data into a bundle (measured by test/bundle-budgets.json's
// chat entry), so the launcher's first question takes its own-words names
// from `own-agent.ts` instead, and the journey's lines load on demand.

import { EXAMPLE_AGENT_SLUGS } from "@stigmer/examples";
import { isOwnAgentSlug } from "./own-agent.js";

export { OWN_AGENT_SLUG, OWN_AGENT_TRIES, isOwnAgentSlug, ownAgentSlug } from "./own-agent.js";

/** Whether `slug` is an agent the journey made: an example's, or one described in the person's own words. */
export function isJourneyAgentSlug(slug: string): boolean {
  return EXAMPLE_AGENT_SLUGS.includes(slug) || isOwnAgentSlug(slug);
}
