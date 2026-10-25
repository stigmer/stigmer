/**
 * What each customer's agent gets, as the five titles every surface uses.
 * The homepage's cards and the hero's picture read them through
 * site/src/lib/agent-gets.ts, which adds each one's icon, words and page; the
 * marketing films read them here, so a title changed once changes everywhere.
 * Keyed by the ids the site's AGENT_GET_IDS lists, in the vocabulary's order.
 */
export const AGENT_GET_TITLES = {
  "own-computer": "Its own computer",
  hours: "It works for hours",
  "asks-first": "It asks first",
  walls: "Walls between customers",
  keys: "Your keys, your servers",
} as const;
