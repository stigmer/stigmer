/**
 * Where a marketplace tree comes from, as the console knows it.
 *
 * The record is the CLI's (`~/.stigmer/config.yaml`'s `marketplaces` entry)
 * minus the `local` source a browser has no filesystem for: the built-in
 * official catalogue, or a public GitHub repository at a ref. The GitHub
 * record is the shared module's, so a source typed in either client parses
 * to one shape and prints with one phrase.
 */

import type { GitHubMarketplaceSource } from "@stigmer/plugin-package/client";

export type { GitHubMarketplaceSource };

/** Where a marketplace tree comes from. */
export type MarketplaceSource =
  /** The catalogue the server's release ships: `@stigmer/plugins` at the server's version. */
  | { readonly type: "official" }
  | GitHubMarketplaceSource;

/** A marketplace the console can read, named as the user sees it. */
export interface KnownMarketplace {
  readonly name: string;
  readonly source: MarketplaceSource;
}

/**
 * A marketplace tree the console can read: every file the host lists, with
 * its size, and a way to fetch one. `fetchFile` returns exactly `size`
 * bytes or rejects; the tree is read at one commit, so the answer cannot
 * change between the listing and the read.
 */
export interface MarketplaceTree {
  /** One phrase naming the tree for sentences, e.g. `github.com/cursor/plugins@abc123`. */
  readonly describe: string;
  /** Root-relative POSIX paths and declared sizes; files only. */
  readonly files: readonly { readonly path: string; readonly size: number }[];
  readonly fetchFile: (path: string) => Promise<Uint8Array>;
}

/** The HTTP client a source reads through; injectable so tests run with none. */
export type FetchImpl = typeof globalThis.fetch;

/**
 * A refusal a source raises before or while reading a tree: what happened,
 * why, and (where a client can act) what to do, in one message.
 */
export class MarketplaceSourceError extends Error {
  constructor(
    message: string,
    /** Coarse class so a component can choose an icon or a retry affordance. */
    readonly reason:
      | "unreachable"
      | "not-found"
      | "refused"
      | "too-large"
      | "unavailable-on-dev-server",
  ) {
    super(message);
    this.name = "MarketplaceSourceError";
  }
}

/** The caps a hosted tree must fit under; each refusal names the one it hit. */
export const MARKETPLACE_TREE_LIMITS = {
  /** Files a tree listing may carry; the CLI's zipball cap, measured against the three vendors' trees. */
  entries: 20_000,
  /**
   * The bytes one plugin's files may sum to. The server refuses an archive
   * over 100 MiB (`MAX_ZIP_SIZE`); this is checked from declared sizes
   * before a byte is fetched.
   */
  pluginBytes: 100 * 1024 * 1024,
} as const;

/** `bytes` as the MiB figure every size sentence quotes, one decimal. */
export function formatMib(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
