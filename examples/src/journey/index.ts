// Which agents a newcomer made on the journey from a first agent to their
// users: an example's agent (the React kit's first question makes it under
// the example's slug) or one described in their own words (`your-agent`,
// then `your-agent-2` and on). The kit makes agents under these names and
// the server reads them when it says how far an organization got, so both
// import this entry. It carries no example's data, only names, so a first
// download and the server stay light: `@stigmer/examples/journey`.

import { EXAMPLE_AGENT_SLUGS } from "./slugs.gen.js";
import { isOwnAgentSlug } from "./own-agent.js";

export { EXAMPLE_AGENT_SLUGS };
export { OWN_AGENT_SLUG, OWN_AGENT_TRIES, isOwnAgentSlug, ownAgentSlug } from "./own-agent.js";

/**
 * Whether `slug` is an agent the journey made: an example's, or one
 * described in the person's own words. An agent a plugin installed, or one
 * made some other way, is not.
 */
export function isJourneyAgentSlug(slug: string): boolean {
  return EXAMPLE_AGENT_SLUGS.includes(slug) || isOwnAgentSlug(slug);
}
