// Every marketplace source becomes a directory, and every directory is read by
// the one plugin walker. This module is where a source turns into that
// directory and where the directory's lifetime is owned: a local path is used
// where it is; the official tree is resolved or acquired; a GitHub zipball is
// extracted under a temp directory that `dispose` removes. One owner for the
// lifetime means `add`, `show` and `install` cannot leak a temp tree between
// them, whatever path an error takes.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MarketplaceSource } from "./config.js";
import { fetchGitHubTree } from "./github.js";
import {
  type ResolveOfficialOptions,
  resolveOfficialMarketplace,
} from "./official.js";

/** A marketplace tree on disk, for as long as the caller holds it. */
export interface OpenMarketplace {
  /** Absolute path to the tree root: the directory the marketplace file sits in. */
  readonly root: string;
  /** Release whatever the open created (a temp directory); a no-op for a tree that was already there. */
  dispose(): void;
}

export interface OpenMarketplaceOptions {
  /** The HTTP client for GitHub sources (injectable for tests). */
  readonly fetchImpl?: typeof globalThis.fetch;
  /** How the official tree is found (injectable for tests). */
  readonly official?: ResolveOfficialOptions;
}

export async function openMarketplace(
  source: MarketplaceSource,
  options: OpenMarketplaceOptions = {},
): Promise<OpenMarketplace> {
  switch (source.type) {
    case "local":
      return { root: source.path, dispose: () => {} };
    case "official":
      return {
        root: resolveOfficialMarketplace(options.official).dir,
        dispose: () => {},
      };
    case "github": {
      const root = mkdtempSync(join(tmpdir(), "stigmer-marketplace-"));
      const dispose = (): void =>
        rmSync(root, { recursive: true, force: true });
      try {
        await fetchGitHubTree(source, {
          destDir: root,
          fetchImpl: options.fetchImpl,
        });
      } catch (error) {
        dispose();
        throw error;
      }
      return { root, dispose };
    }
    default: {
      const exhaustive: never = source;
      return exhaustive;
    }
  }
}

/** Open, hand the tree to `use`, and dispose whatever the outcome. */
export async function withMarketplace<T>(
  source: MarketplaceSource,
  use: (open: OpenMarketplace) => Promise<T> | T,
  options: OpenMarketplaceOptions = {},
): Promise<T> {
  const open = await openMarketplace(source, options);
  try {
    return await use(open);
  } finally {
    open.dispose();
  }
}
