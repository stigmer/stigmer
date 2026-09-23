/**
 * What a marketplace is once read, and the closed vocabulary of findings a
 * marketplace read can produce.
 *
 * A marketplace is a directory tree with a marketplace file that lists the
 * plugins it offers, each as a name and a directory inside the tree. That is
 * the convention Cursor (`.cursor-plugin/marketplace.json`), Claude Code
 * (`.claude-plugin/marketplace.json`) and Codex (`.agents/plugins/
 * marketplace.json`) already publish, and the agent-plugins.org
 * specification leaves marketplaces client-owned, so there is no open
 * format to defer to; Stigmer's own file sits at the tree root as
 * `marketplace.json`, the position the open plugin manifest takes. The four
 * dialects reduce to one shape here: a client that can read this shape can
 * install from any of the four catalogues.
 *
 * Two error postures, stated as the plugin reader states them. A marketplace
 * FILE that is broken (unreadable, unnamed, no plugin list, a source that
 * escapes the tree, two entries with one name) refuses the marketplace: a
 * catalogue that cannot be trusted as a whole is not offered at all. An
 * ENTRY that cannot be installed (a source form this reader does not fetch,
 * a directory the tree does not hold, a directory with no plugin manifest)
 * is dropped with a warning: a user adding a public catalogue of eighty
 * plugins should still see the seventy-nine that work, and a catalogue's
 * own static suite asserts zero warnings so the publisher hears about the
 * one. Every kind has exactly one sentence in `messages.ts` and exactly one
 * adversarial fixture.
 */

import type { Finding } from "../outcome.js";

/** The marketplace file dialects, in the precedence the reader applies. */
export type MarketplaceDialect = "stigmer" | "claude" | "cursor" | "codex";

export type MarketplaceErrorKind =
  // The file
  | "marketplace-not-found"
  | "marketplace-too-large"
  | "marketplace-unreadable"
  | "marketplace-field-type"
  | "marketplace-name-missing"
  | "marketplace-name-invalid"
  | "marketplace-plugins-missing"
  // Entries
  | "entry-shape"
  | "entry-name-missing"
  | "entry-name-invalid"
  | "entry-name-duplicate"
  | "entry-source-missing"
  | "entry-source-escapes-root";

export type MarketplaceWarningKind =
  | "entry-source-unsupported"
  | "entry-directory-missing"
  | "entry-not-a-plugin";

export type MarketplaceFindingKind = MarketplaceErrorKind | MarketplaceWarningKind;

export type MarketplaceFinding = Finding<MarketplaceFindingKind>;

export interface MarketplaceOwner {
  readonly name?: string;
  readonly email?: string;
  readonly url?: string;
}

/** One installable plugin the marketplace offers. */
export interface MarketplaceEntry {
  /** The name a user installs it by; unique within the marketplace. */
  readonly name: string;
  /** The plugin's directory, marketplace-relative with no leading `./`; the empty string is the tree root. */
  readonly dir: string;
  /** The catalogue's own one-line description, when the file carries one. */
  readonly description?: string;
}

export interface Marketplace {
  /** The marketplace's identifier, the prefix in `install <marketplace>/<plugin>`. */
  readonly name: string;
  readonly description?: string;
  readonly owner?: MarketplaceOwner;
  /** The dialect whose file named the marketplace. */
  readonly dialect: MarketplaceDialect;
  /** The marketplace file that was read, tree-relative. */
  readonly path: string;
  /** Installable entries, in the file's order; entries the reader dropped are in the warnings. */
  readonly plugins: readonly MarketplaceEntry[];
}

export type MarketplaceReadOutcome =
  | { readonly ok: true; readonly marketplace: Marketplace; readonly warnings: readonly MarketplaceFinding[] }
  | { readonly ok: false; readonly errors: readonly MarketplaceFinding[]; readonly warnings: readonly MarketplaceFinding[] };
