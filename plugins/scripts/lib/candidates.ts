/**
 * A directory as the tree a plugin client holds before selection: every
 * regular file under it with its size, plus a reader for the bytes.
 *
 * This is deliberately NOT a selection. Which of these files a plugin
 * carries, in what order, and which are dropped by an ignore file or the
 * security defaults is the shared rule in `@stigmer/plugin-package/client`
 * (`selectPluginFiles`, reached here through `preparePluginFromTree`), the
 * one rule the CLI and the console both apply. A walk that decided anything
 * would be a second rule. So this module only lists: paths POSIX and
 * root-relative, symlinks skipped (the CLI's walker never follows one), the
 * `.git` directory skipped because a checkout's history is not part of any
 * tree a marketplace publishes.
 *
 * The same listing serves `readMarketplace`, which takes a `PluginFiles`
 * (sorted by code point, files only) and consults the marketplace file and
 * the directories it names; `asPluginFiles` is that view of the listing.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { comparePaths, type PluginFileEntry, type PluginFiles } from "@stigmer/plugin-package";
import type { LazyCandidate } from "@stigmer/plugin-package/client";

/** Directories at any depth that are never part of a published tree. */
const NEVER_LISTED: ReadonlySet<string> = new Set([".git"]);

export interface DirectoryListing {
  /** Every regular file, root-relative, in directory order. */
  readonly candidates: readonly LazyCandidate[];
  /** The bytes of one listed path, synchronously. */
  read(path: string): Uint8Array;
}

/** List `root` as candidates with a reader over the same directory. */
export function listDirectory(root: string): DirectoryListing {
  const candidates: LazyCandidate[] = [];
  const read = (path: string): Uint8Array => new Uint8Array(readFileSync(join(root, ...path.split("/"))));
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (NEVER_LISTED.has(entry.name)) continue;
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), path);
      } else if (entry.isFile()) {
        const size = statSync(join(dir, entry.name)).size;
        candidates.push({ path, size, read: () => Promise.resolve(read(path)) });
      }
    }
  };
  walk(root, "");
  return { candidates, read };
}

/** The listing in the shape the readers take: sorted by code point, files only. */
export function asPluginFiles(listing: DirectoryListing): PluginFiles {
  const entries: PluginFileEntry[] = listing.candidates
    .map((candidate) => ({ path: candidate.path, size: candidate.size }))
    .sort((a, b) => comparePaths(a.path, b.path));
  return { entries, read: (path) => listing.read(path) };
}

/** The listing narrowed to one directory inside it, re-rooted there. */
export function subtree(listing: DirectoryListing, dir: string): DirectoryListing {
  if (dir === "") return listing;
  const prefix = `${dir}/`;
  const candidates = listing.candidates
    .filter((candidate) => candidate.path.startsWith(prefix))
    .map((candidate) => {
      const path = candidate.path.slice(prefix.length);
      return { path, size: candidate.size, read: candidate.read };
    });
  return { candidates, read: (path) => listing.read(`${prefix}${path}`) };
}
