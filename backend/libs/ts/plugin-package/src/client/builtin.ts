/**
 * The sources every client lists without being told: Stigmer's official
 * catalogue and the three vendors' public ones.
 *
 * The product's promise is "bring your Cursor, Claude Code or Codex
 * plugin", so the catalogues those vendors publish are on offer from the
 * first screen, in the console's Marketplace and in `stigmer marketplace
 * list`, without a user having to know a repository slug. They are code,
 * not stored state: a client's remembered sources hold only what the user
 * added, so the two clients cannot drift from each other and a vendor
 * moving its repository is one release, not a migration. The names are
 * reserved the way the official one is; a user can neither add nor remove
 * them.
 *
 * Each vendor keeps its marketplace file at the repository root in its own
 * location, all four of which `readMarketplace` reads (`.cursor-plugin/`,
 * `.claude-plugin/`, `.agents/plugins/`). Measured on 2026-09-18 through
 * the GitHub Trees API: 1,168, 1,594 and 7,746 entries respectively, none
 * truncated, all under the console's 20,000-entry listing cap; Codex's
 * catalogue names its entries as `{source: "local", path}` objects, which
 * the reader accepts, and three of its 65 as remote sources, which it
 * drops with its own sentence.
 */

import type { GitHubMarketplaceSource } from "./refs.js";
import { OFFICIAL_MARKETPLACE_NAME } from "./refs.js";

/** A source a client ships with: named, described for a section heading, and either the official catalogue or a public GitHub tree. */
export interface BuiltInMarketplace {
  readonly name: string;
  /** One sentence for the Marketplace's section heading and `marketplace list`. */
  readonly description: string;
  readonly source: { readonly type: "official" } | GitHubMarketplaceSource;
}

/** In listing order: the official catalogue first, then the vendors in the order the product names them. */
export const BUILT_IN_MARKETPLACES: readonly BuiltInMarketplace[] = [
  {
    name: OFFICIAL_MARKETPLACE_NAME,
    description: "Stigmer's official catalogue, published with each release.",
    source: { type: "official" },
  },
  {
    name: "cursor-plugins",
    description: "Cursor's public plugin catalogue.",
    source: { type: "github", repo: "cursor/plugins" },
  },
  {
    name: "claude-code-plugins",
    description: "Claude Code's public plugin catalogue.",
    source: { type: "github", repo: "anthropics/claude-code" },
  },
  {
    name: "codex-plugins",
    description: "Codex's public plugin catalogue.",
    source: { type: "github", repo: "openai/plugins" },
  },
];

const BUILT_IN_NAMES: ReadonlySet<string> = new Set(BUILT_IN_MARKETPLACES.map((entry) => entry.name));

/** Whether `name` is one a user may neither add nor remove. */
export function isBuiltInMarketplaceName(name: string): boolean {
  return BUILT_IN_NAMES.has(name);
}
