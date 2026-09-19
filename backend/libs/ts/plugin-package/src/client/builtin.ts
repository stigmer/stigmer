/**
 * The one source every client lists without being told: Stigmer's official
 * catalogue.
 *
 * The catalogue is curated (`plugins/README.md`, "What the catalogue holds"):
 * every entry is one Stigmer may ship and one whose servers Stigmer can
 * connect to, vendored from a publisher's redistributable set or authored
 * by Stigmer for a vendor's public endpoint. The vendors' own repositories
 * were built in for one release and were taken out again when the audit
 * behind the catalogue measured that more than half of their entries fail
 * that bar: a chip that offers what the catalogue left out re-surfaces
 * what curation removed. A user who wants another catalogue adds it as a
 * source of his own (a repository with a marketplace file, read from
 * GitHub), in the console's Manage sources or with `stigmer marketplace
 * add`; the vendors' repositories are ordinary candidates for that, at the
 * user's word, never on offer by default.
 *
 * The list is code, not stored state: a client's remembered sources hold
 * only what the user added, so the two clients cannot drift from each
 * other. The official name is reserved the way it always was; a user can
 * neither add over it nor remove it.
 */

import type { GitHubMarketplaceSource } from "./refs.js";
import { OFFICIAL_MARKETPLACE_NAME } from "./refs.js";

/** A source a client ships with: named, and either the official catalogue or a public GitHub tree. */
export interface BuiltInMarketplace {
  readonly name: string;
  readonly source: { readonly type: "official" } | GitHubMarketplaceSource;
}

/** In listing order. Today one entry; the type keeps the shape a future built-in would take. */
export const BUILT_IN_MARKETPLACES: readonly BuiltInMarketplace[] = [
  {
    name: OFFICIAL_MARKETPLACE_NAME,
    source: { type: "official" },
  },
];

const BUILT_IN_NAMES: ReadonlySet<string> = new Set(BUILT_IN_MARKETPLACES.map((entry) => entry.name));

/** Whether `name` is one a user may neither add nor remove. */
export function isBuiltInMarketplaceName(name: string): boolean {
  return BUILT_IN_NAMES.has(name);
}

/** The one sentence every client refuses with when a user tries to add over or remove a built-in source. */
export function builtInSourceRefusal(name: string, act: "add" | "remove"): string {
  switch (act) {
    case "add":
      return `'${name}' is a built-in source and cannot be added or replaced; choose another name`;
    case "remove":
      return `'${name}' is a built-in source and cannot be removed`;
    default: {
      const exhaustive: never = act;
      return exhaustive;
    }
  }
}
