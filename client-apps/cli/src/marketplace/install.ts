// An entry of an open marketplace becomes a prepared push. This is the one
// place that happens, for both callers: `stigmer install <ref>` and the
// `stigmer up` default-set step. Neither re-derives the entry's directory or
// the archive's digest; both hand the prepared value to `pushPrepared` (or,
// for `up`, compare its digest first). The entry's directory goes through the
// same walker `push plugin <dir>` uses, so a marketplace install and a push
// of the same checked-out folder yield one digest for one tree.

import { type MarketplaceEntry } from "@stigmer/plugin-package";
import { UsageError } from "../errors/index.js";
import {
  type PreparedPluginPush,
  preparePluginPush,
} from "../resources/plugin.js";
import {
  type KnownMarketplace,
  type MarketplaceListing,
  describeSource,
} from "./config.js";
import {
  type OpenMarketplace,
  type OpenMarketplaceOptions,
  openMarketplace,
} from "./materialize.js";
import { peekGitHubMarketplace } from "./github.js";
import {
  type ReadMarketplaceTree,
  entryDirectory,
  findEntry,
  marketplaceRefusal,
  readMarketplaceTree,
} from "./read.js";
import { type InstallRef, formatInstallRef } from "./ref.js";

/** A ref resolved to the one marketplace that offers it, with that marketplace open on disk. */
export interface LocatedEntry {
  readonly marketplace: KnownMarketplace;
  readonly open: OpenMarketplace;
  readonly tree: ReadMarketplaceTree;
}

/**
 * Find the source a ref names. A prefixed ref names it outright; a bare
 * name is searched across every known source in listing order (the official
 * one first), and exactly one must offer it: none refuses toward
 * `marketplace show`, more than one refuses by naming each holder, because
 * "the first one wins" would make the answer depend on the order the user
 * added sources in. The caller owns `open` and disposes it.
 *
 * The search is cheap by design: a GitHub source is asked through its
 * marketplace file alone (`peekGitHubMarketplace`, a few KB), and only the
 * one source that declares the name is opened as a tree and read whole,
 * which is where "declared" becomes "offered" or the install refuses. With
 * the vendors' catalogues built in, the alternative was three zipballs per
 * bare install.
 */
export async function locateEntry(
  ref: InstallRef,
  listing: MarketplaceListing,
  options: OpenMarketplaceOptions = {},
): Promise<LocatedEntry> {
  if (ref.marketplace !== undefined) {
    const marketplace = listing.known.find(
      (known) => known.name === ref.marketplace,
    );
    if (marketplace === undefined) {
      throw new UsageError(
        `no marketplace named '${ref.marketplace}' is configured\n\n` +
          "Run 'stigmer marketplace list' to see the configured names, or add one with 'stigmer marketplace add <source>'.",
      );
    }
    const open = await openMarketplace(marketplace.source, options);
    try {
      const tree = readMarketplaceTree(
        open.root,
        describeSource(marketplace.source),
      );
      if (findEntry(tree.marketplace, ref.name) === undefined)
        throw entryNotOffered(tree, ref.name);
      return { marketplace, open, tree };
    } catch (error) {
      open.dispose();
      throw error;
    }
  }

  const holders: LocatedEntry[] = [];
  for (const marketplace of listing.known) {
    let located: LocatedEntry | undefined;
    try {
      located = await locateIn(marketplace, ref.name, options);
    } catch (error) {
      for (const holder of holders) holder.open.dispose();
      throw error;
    }
    if (located !== undefined) holders.push(located);
  }
  if (holders.length === 1) return holders[0]!;
  for (const holder of holders) holder.open.dispose();
  if (holders.length === 0) {
    const skipped =
      listing.unreadable.length === 0
        ? ""
        : ` Not searched, because its entry cannot be read: ${listing.unreadable.map((entry) => entry.name).join(", ")} (see 'stigmer marketplace list').`;
    throw new UsageError(
      `no configured marketplace offers a plugin named '${ref.name}'\n\n` +
        `Searched: ${listing.known.map((known) => known.name).join(", ")}.${skipped} ` +
        "Run 'stigmer marketplace show <name>' to see what each offers, or add the marketplace that has it.",
    );
  }
  throw new UsageError(
    `'${ref.name}' is offered by more than one marketplace: ${holders.map((holder) => holder.marketplace.name).join(", ")}\n\n` +
      `Name the one you mean: ${holders.map((holder) => formatInstallRef({ ...ref, marketplace: holder.marketplace.name })).join(" or ")}.`,
  );
}

/**
 * The entry called `name` in one source, opened and read, or `undefined`
 * when the source does not offer it. A GitHub source is first asked through
 * its marketplace file alone (a few KB); its zipball is downloaded only when
 * the file declares the name, and the tree read then decides whether it is
 * held. A local or official tree is on disk and is read once. A GitHub
 * repository with no marketplace file declares nothing (a built-in whose
 * vendor moved the file must not break every bare install); one whose file
 * the library refuses is a real fault and is said so.
 */
async function locateIn(
  marketplace: KnownMarketplace,
  name: string,
  options: OpenMarketplaceOptions,
): Promise<LocatedEntry | undefined> {
  if (marketplace.source.type === "github") {
    const peek = await peekGitHubMarketplace(
      marketplace.source,
      options.fetchImpl,
    );
    if (!peek.ok) {
      switch (peek.kind) {
        case "not-a-marketplace":
          return undefined;
        case "refused":
          throw marketplaceRefusal(
            `${describeSource(marketplace.source)} (${peek.location})`,
            peek.errors,
            peek.warnings,
          );
        default: {
          const exhaustive: never = peek;
          return exhaustive;
        }
      }
    }
    if (findEntry(peek.peeked.marketplace, name) === undefined) return undefined;
  }

  const open = await openMarketplace(marketplace.source, options);
  try {
    const tree = readMarketplaceTree(open.root, describeSource(marketplace.source));
    if (findEntry(tree.marketplace, name) === undefined) {
      // Declared by a file but not held by the tree, or simply absent: not a
      // holder. The not-found sentence names every source searched.
      open.dispose();
      return undefined;
    }
    return { marketplace, open, tree };
  } catch (error) {
    open.dispose();
    throw error;
  }
}

/** Read, validate and zip the entry called `name`; refuses an entry the marketplace does not offer. */
export async function prepareEntry(
  tree: ReadMarketplaceTree,
  name: string,
): Promise<PreparedPluginPush> {
  const entry = findEntry(tree.marketplace, name);
  if (entry === undefined) throw entryNotOffered(tree, name);
  return preparePluginPush(entryDirectory(tree, entry));
}

/**
 * `@version` in a ref is an assertion, not a selector: a marketplace tree
 * holds one version of each plugin, so the ref either names it or is wrong.
 */
export function assertVersion(
  prepared: PreparedPluginPush,
  wanted: string | undefined,
  ref: string,
): void {
  if (wanted === undefined) return;
  const offered = prepared.plugin.version;
  if (offered === wanted) return;
  throw new UsageError(
    offered === undefined
      ? `'${ref}' pins version ${wanted}, but the marketplace's '${prepared.plugin.name}' declares no version\n\nInstall it without '@${wanted}'.`
      : `'${ref}' pins version ${wanted}, but the marketplace offers '${prepared.plugin.name}' at ${offered}\n\nInstall it as '${ref.slice(0, ref.lastIndexOf("@"))}@${offered}', or without a version.`,
  );
}

function entryNotOffered(tree: ReadMarketplaceTree, name: string): UsageError {
  const dropped = tree.warnings.find((warning) => warning.subject === name);
  const offered = tree.marketplace.plugins.map(
    (entry: MarketplaceEntry) => entry.name,
  );
  const lines = [
    `marketplace '${tree.marketplace.name}' does not offer a plugin named '${name}'`,
  ];
  if (dropped !== undefined) lines.push("", dropped.message);
  lines.push(
    "",
    offered.length === 0
      ? "It offers no plugins this CLI can install."
      : `Run 'stigmer marketplace show ${tree.marketplace.name}' to see the ${offered.length} it offers.`,
  );
  return new UsageError(lines.join("\n"));
}
