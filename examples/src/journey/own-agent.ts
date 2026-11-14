// The names an agent described in the person's own words is made under:
// `your-agent`, then `your-agent-2` and on, up to the tries the React kit's
// first question makes. The kit makes agents under these names and the
// server counts them as the journey's, so both read this one module.

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
