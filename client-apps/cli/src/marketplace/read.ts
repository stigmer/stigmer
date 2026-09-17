// A marketplace tree on disk, read into the library's one shape.
//
// `@stigmer/plugin-package` is pure over a `PluginFiles`; the CLI feeds it
// the same gitignore-aware walk `push plugin` uses (`readPluginDirectory`),
// rooted at the marketplace tree, so what `show` lists is what the tree
// holds after the ignore rules that would apply to a push from it. The
// library's refusal (a broken marketplace FILE) becomes one `UsageError`
// with every sentence, the shape `pluginRefusal` prints for a plugin; its
// warnings (entries the tree cannot offer) travel with the marketplace so
// `show` can say why an entry is missing.

import { join } from "node:path";
import {
  type Marketplace,
  type MarketplaceEntry,
  type MarketplaceFinding,
  readMarketplace,
} from "@stigmer/plugin-package";
import { UsageError } from "../errors/index.js";
import { count, readPluginDirectory } from "../resources/plugin.js";

export interface ReadMarketplaceTree {
  readonly root: string;
  readonly marketplace: Marketplace;
  /** The library's warnings: entries dropped, each with its own sentence. */
  readonly warnings: readonly MarketplaceFinding[];
}

/** Read the tree at `root`; a marketplace the library refuses throws with every problem named. */
export function readMarketplaceTree(
  root: string,
  describe: string = root,
): ReadMarketplaceTree {
  const directory = readPluginDirectory(root);
  const outcome = readMarketplace(directory.files);
  if (!outcome.ok)
    throw marketplaceRefusal(describe, outcome.errors, outcome.warnings);
  return { root, marketplace: outcome.marketplace, warnings: outcome.warnings };
}

/** The library's refusal as the CLI's one UsageError: every problem, then every warning. */
export function marketplaceRefusal(
  describe: string,
  errors: readonly MarketplaceFinding[],
  warnings: readonly MarketplaceFinding[],
): UsageError {
  const lines = [
    `${describe}: not a marketplace this CLI can read, ${count(errors.length, "problem")} found:`,
    ...errors.map((finding) => `  - ${finding.message}`),
  ];
  if (warnings.length > 0) {
    lines.push(
      `and ${count(warnings.length, "warning")}:`,
      ...warnings.map((finding) => `  - ${finding.message}`),
    );
  }
  return new UsageError(lines.join("\n"));
}

/** The offered entry called `name`, or `undefined`. */
export function findEntry(
  marketplace: Marketplace,
  name: string,
): MarketplaceEntry | undefined {
  return marketplace.plugins.find((entry) => entry.name === name);
}

/** The absolute directory of an offered entry: what the plugin walker reads next. */
export function entryDirectory(
  tree: ReadMarketplaceTree,
  entry: MarketplaceEntry,
): string {
  return entry.dir === ""
    ? tree.root
    : join(tree.root, ...entry.dir.split("/"));
}
