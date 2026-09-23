// What `stigmer marketplace list` and `show` print, as `CommandResult`s: the
// human form on stderr, the same facts as `data` on stdout under `--json`.
// The marketplace group renders the way `config backend list` does (a
// mutating-class result rather than a read-verb table) because it is the
// same kind of thing: client-side configuration, not a server collection.

import { readPluginPackage } from "@stigmer/plugin-package";
import { CommandResult } from "../output/index.js";
import { count, readPluginDirectory } from "../resources/plugin.js";
import {
  type KnownMarketplace,
  type MarketplaceListing,
  describeSource,
} from "./config.js";
import { type ReadMarketplaceTree, entryDirectory } from "./read.js";

export function renderMarketplaceList(
  listing: MarketplaceListing,
): CommandResult {
  const total = listing.known.length + listing.unreadable.length;
  const result =
    listing.unreadable.length === 0
      ? CommandResult.success(`${count(total, "source")} known`)
      : CommandResult.warning(
          `${count(total, "source")} known, ${count(listing.unreadable.length, "entry")} this CLI cannot read`,
        );
  const section = result.addSection("Sources");
  for (const marketplace of listing.known) {
    section.field(marketplace.name, describeSource(marketplace.source));
  }
  for (const marketplace of listing.unreadable) {
    section.field(marketplace.name, `cannot be read: ${marketplace.reason}`);
  }
  result.hint("Show what one offers with: stigmer marketplace show <name>");
  result.hint("Install from one with:      stigmer install [<name>/]<plugin>");
  return result.withData({
    marketplaces: [
      ...listing.known.map((marketplace) => ({
        name: marketplace.name,
        source: marketplace.source,
      })),
      ...listing.unreadable.map((marketplace) => ({
        name: marketplace.name,
        unreadable: marketplace.reason,
      })),
    ],
  });
}

/** One offered entry as `show` reports it, after its own manifest has been read. */
export interface ShownEntry {
  readonly name: string;
  readonly dir: string;
  readonly version?: string;
  readonly description?: string;
  /** Set when the entry's own package refuses to read; `show` still lists it so the gap is visible. */
  readonly problems?: number;
}

/**
 * Read each offered entry's own package for its version and description.
 * The marketplace file's description is a fallback (Stigmer's own catalogue
 * carries none, so nothing is written twice); the plugin's manifest is the
 * truth a user installs.
 */
export function inspectEntries(tree: ReadMarketplaceTree): ShownEntry[] {
  return tree.marketplace.plugins.map((entry) => {
    const outcome = readPluginPackage(
      readPluginDirectory(entryDirectory(tree, entry)).files,
    );
    if (!outcome.ok) {
      return {
        name: entry.name,
        dir: entry.dir,
        ...(entry.description !== undefined && {
          description: entry.description,
        }),
        problems: outcome.errors.length,
      };
    }
    const description = outcome.plugin.description ?? entry.description;
    return {
      name: entry.name,
      dir: entry.dir,
      ...(outcome.plugin.version !== undefined && {
        version: outcome.plugin.version,
      }),
      ...(description !== undefined && { description }),
    };
  });
}

export function renderMarketplaceShow(
  marketplace: KnownMarketplace,
  tree: ReadMarketplaceTree,
  entries: readonly ShownEntry[],
): CommandResult {
  const installable = entries.filter(
    (entry) => entry.problems === undefined,
  ).length;
  const headline = `Marketplace '${marketplace.name}' offers ${count(installable, "plugin")}`;
  const result =
    tree.warnings.length === 0 && installable === entries.length
      ? CommandResult.success(headline)
      : CommandResult.warning(
          `${headline}, with ${count(tree.warnings.length + (entries.length - installable), "warning")}`,
        );

  const about = result.addSection("Marketplace");
  about.field("Name", tree.marketplace.name);
  about.field("Source", describeSource(marketplace.source));
  if (tree.marketplace.description !== undefined)
    about.field("Description", tree.marketplace.description);
  if (tree.marketplace.owner?.name !== undefined)
    about.field("Owner", tree.marketplace.owner.name);
  about.field("Format", tree.marketplace.path);

  const plugins = result.addSection("Plugins");
  for (const entry of entries) {
    const version = entry.version === undefined ? "" : `@${entry.version}`;
    const tail =
      entry.problems !== undefined
        ? `  (not installable: ${count(entry.problems, "problem")}; run 'stigmer validate -f' on it)`
        : entry.description === undefined
          ? ""
          : `  ${entry.description}`;
    plugins.item(`${entry.name}${version}${tail}`);
  }

  if (tree.warnings.length > 0) {
    const section = result.addSection("Not offered");
    for (const warning of tree.warnings) section.item(warning.message);
  }
  result.hint(`Install one with: stigmer install ${marketplace.name}/<plugin>`);
  return result.withData({
    marketplace: {
      name: tree.marketplace.name,
      source: marketplace.source,
      dialect: tree.marketplace.dialect,
      path: tree.marketplace.path,
      ...(tree.marketplace.description !== undefined && {
        description: tree.marketplace.description,
      }),
      ...(tree.marketplace.owner !== undefined && {
        owner: tree.marketplace.owner,
      }),
    },
    plugins: entries,
    warnings: tree.warnings,
  });
}
