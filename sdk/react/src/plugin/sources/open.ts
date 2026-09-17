/**
 * One entry point from a source to an opened marketplace: pick the reader
 * for the source's type, open the tree, read the catalogue. The official
 * catalogue needs the server's version, which the caller has already asked
 * the platform for; a GitHub source needs nothing but the network.
 */

import type { Stigmer } from "@stigmer/sdk";

import { openGitHubTree } from "./github.js";
import { openOfficialTree } from "./official.js";
import { type OpenedMarketplace, openMarketplace } from "./read.js";
import type { FetchImpl, MarketplaceSource } from "./types.js";

export interface OpenSourceOptions {
  /** The HTTP client the sources read through; `globalThis.fetch` when absent. */
  readonly fetchImpl?: FetchImpl;
}

/** Open and read the marketplace `source` names. */
export async function openMarketplaceSource(
  source: MarketplaceSource,
  stigmer: Stigmer,
  options: OpenSourceOptions = {},
): Promise<OpenedMarketplace> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  switch (source.type) {
    case "official": {
      const info = await stigmer.platform.getServerInfo();
      return openMarketplace(await openOfficialTree(info.version, fetchImpl));
    }
    case "github":
      return openMarketplace(await openGitHubTree(source, fetchImpl));
    default: {
      const exhaustive: never = source;
      throw new Error(`unknown marketplace source ${JSON.stringify(exhaustive)}`);
    }
  }
}
