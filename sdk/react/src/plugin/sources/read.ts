/**
 * A hosted marketplace tree read into the library's shapes, and an entry
 * of it prepared for the push the server expects.
 *
 * The library's readers are synchronous over a `PluginFiles` whose `read`
 * returns bytes; a hosted tree yields bytes asynchronously. So each step
 * here fetches exactly what its reader will ask for, ahead of time, then
 * hands over a reader that answers from memory:
 *
 * - `openMarketplace` fetches the ONE marketplace file the tree carries
 *   (`readMarketplace` decides everything else from paths alone) and reads
 *   the catalogue.
 * - `prepareEntry` hands the entry's subtree to the shared preparation as a
 *   lazily-read tree (budgeted from the declared sizes before a byte moves,
 *   then the selected bytes only), so the console arrives at the CLI's
 *   digest for the same tree through the same function the CLI runs.
 *
 * Refusals keep the library's sentences: a plugin the library refuses is
 * reported with every problem, the way `stigmer validate -f` prints it.
 */

import {
  type Marketplace,
  type MarketplaceEntry,
  type MarketplaceFinding,
  type PluginFinding,
  type PluginPackage,
  MARKETPLACE_LOCATIONS,
  inMemoryPluginFiles,
  readMarketplace,
} from "@stigmer/plugin-package";
import { type LazyCandidate, type SelectionStats, preparePluginFromTree } from "@stigmer/plugin-package/client";

import { MARKETPLACE_TREE_LIMITS, MarketplaceSourceError, type MarketplaceTree } from "./types.js";

/** A marketplace read from a hosted tree, with the tree kept for the install that follows. */
export interface OpenedMarketplace {
  readonly tree: MarketplaceTree;
  readonly marketplace: Marketplace;
  /** Entries the reader dropped, each with its own sentence (`entry-not-a-plugin` and the rest). */
  readonly warnings: readonly MarketplaceFinding[];
}

/** The library refused the marketplace file or the plugin; every sentence travels. */
export class PluginReadRefusal extends Error {
  constructor(
    /** What was being read, for the headline. */
    readonly subject: string,
    readonly errors: readonly (PluginFinding | MarketplaceFinding)[],
    readonly warnings: readonly (PluginFinding | MarketplaceFinding)[],
  ) {
    super(`${subject}: ${errors.length === 1 ? "1 problem" : `${errors.length} problems`} found`);
    this.name = "PluginReadRefusal";
  }
}

/** Read the catalogue a tree carries. */
export async function openMarketplace(tree: MarketplaceTree): Promise<OpenedMarketplace> {
  const locations = new Set<string>(Object.values(MARKETPLACE_LOCATIONS));
  const present = tree.files.filter((file) => locations.has(file.path));
  const contents = new Map<string, Uint8Array>();
  await Promise.all(
    present.map(async (file) => {
      contents.set(file.path, await tree.fetchFile(file.path));
    }),
  );
  const outcome = readMarketplace({
    entries: [...tree.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    read(path) {
      const bytes = contents.get(path);
      if (bytes === undefined) throw new Error(`marketplace read asked for '${path}', which is not a marketplace file`);
      return bytes;
    },
  });
  if (!outcome.ok) throw new PluginReadRefusal(`${tree.describe} is not a marketplace this console can read`, outcome.errors, outcome.warnings);
  return { tree, marketplace: outcome.marketplace, warnings: outcome.warnings };
}

/** An entry read, selected and archived, but not yet pushed: what the install preview shows. */
export interface PreparedInstall {
  readonly entry: MarketplaceEntry;
  readonly plugin: PluginPackage;
  readonly warnings: readonly PluginFinding[];
  readonly stats: SelectionStats;
  /** The exact bytes a push sends. */
  readonly archive: Uint8Array;
  /** SHA-256 of `archive`: the identity the server records, so "already installed" is known before a push. */
  readonly digest: string;
}

/** The offered entry called `name`, or `undefined`. */
export function findEntry(marketplace: Marketplace, name: string): MarketplaceEntry | undefined {
  return marketplace.plugins.find((entry) => entry.name === name);
}

/**
 * Prepare the entry through the one preparation every client runs. The
 * declared sizes are checked before a byte moves (a fast refusal for a
 * subtree no selection could bring under the cap); the shared preparation
 * then reads the ignore files, selects, checks the selected size, and
 * fetches only the files the archive carries, each length-checked against
 * its declaration by the tree itself.
 */
export async function prepareEntry(opened: OpenedMarketplace, entry: MarketplaceEntry): Promise<PreparedInstall> {
  const prefix = entry.dir === "" ? "" : `${entry.dir}/`;
  const candidates: LazyCandidate[] = opened.tree.files
    .filter((file) => file.path.startsWith(prefix))
    .map((file) => ({
      path: file.path.slice(prefix.length),
      size: file.size,
      read: () => opened.tree.fetchFile(file.path),
    }));

  const declared = candidates.reduce((sum, file) => sum + file.size, 0);
  if (declared > MARKETPLACE_TREE_LIMITS.pluginBytes) {
    throw tooLarge(entry.name, declared);
  }

  const outcome = await preparePluginFromTree(candidates, {
    respectGitignore: true,
    maxBytes: MARKETPLACE_TREE_LIMITS.pluginBytes,
  });
  if (!outcome.ok) {
    switch (outcome.kind) {
      case "refused":
        throw new PluginReadRefusal(`'${entry.name}' cannot be installed`, outcome.errors, outcome.warnings);
      case "too-large":
        throw tooLarge(entry.name, outcome.selectedBytes);
      default: {
        const exhaustive: never = outcome;
        return exhaustive;
      }
    }
  }
  const { plugin, warnings, stats, archive, digest } = outcome.prepared;
  return { entry, plugin, warnings, stats, archive, digest };
}

function tooLarge(name: string, bytes: number): MarketplaceSourceError {
  return new MarketplaceSourceError(
    `'${name}' is ${mib(bytes)} of files, over the ${mib(MARKETPLACE_TREE_LIMITS.pluginBytes)} a plugin archive may carry`,
    "too-large",
  );
}

/** The in-memory reader over a fixture, for tests and previews that hold the files already. */
export { inMemoryPluginFiles };

function mib(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
