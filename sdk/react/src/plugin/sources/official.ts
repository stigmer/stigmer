/**
 * The official catalogue as a marketplace tree, read from a browser.
 *
 * `@stigmer/plugins` is published with every release; its package root IS
 * the marketplace tree (`plugins/` in the repository, staged whole). The
 * CLI acquires it at its own version so what it installs matches the
 * control plane; the console reads it at the SERVER's version for the same
 * reason, through the npm CDN: jsdelivr lists a version's files
 * (`data.jsdelivr.com`) and serves them (`cdn.jsdelivr.net`), both with
 * `access-control-allow-origin: *`, and a published version is immutable,
 * so the CDN's long cache is correct here where it would be wrong for a
 * live GitHub branch.
 *
 * A development server (`dev`, `0.0.0-dev`, or any `-dev.` build) has no
 * published catalogue; the console says so in one sentence and the user
 * installs from another source instead. No fallback is built. Which
 * versions count is the shared client predicate, the same one the CLI's
 * acquisition applies, so the two clients never disagree on a version.
 */

import { isReleaseVersion } from "@stigmer/plugin-package/client";

import { type FetchImpl, MARKETPLACE_TREE_LIMITS, MarketplaceSourceError, type MarketplaceTree } from "./types.js";

const PACKAGE = "@stigmer/plugins";

interface FlatListing {
  readonly files: readonly { readonly name: string; readonly size: number }[];
}

/** Whether `version` names a release the catalogue is published for: the shared rule, under this module's older name. */
export function isPublishedVersion(version: string): boolean {
  return isReleaseVersion(version);
}

/** The listing URL for the catalogue at `version`. */
export function officialListingUrl(version: string): string {
  return `https://data.jsdelivr.com/v1/package/npm/${PACKAGE}@${version}/flat`;
}

/** The content URL of `path` in the catalogue at `version`. */
export function officialFileUrl(version: string, path: string): string {
  return `https://cdn.jsdelivr.net/npm/${PACKAGE}@${version}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** Open the catalogue the server's release ships. */
export async function openOfficialTree(serverVersion: string, fetchImpl: FetchImpl): Promise<MarketplaceTree> {
  if (!isPublishedVersion(serverVersion)) {
    throw new MarketplaceSourceError(
      `the official marketplace is published with each release, and this server runs a development build (${serverVersion}); add a GitHub marketplace to install from, or use the CLI`,
      "unavailable-on-dev-server",
    );
  }
  let response: Response;
  try {
    response = await fetchImpl(officialListingUrl(serverVersion));
  } catch (error) {
    throw new MarketplaceSourceError(
      `could not reach the npm CDN for ${PACKAGE}@${serverVersion}: ${error instanceof Error ? error.message : String(error)}`,
      "unreachable",
    );
  }
  if (response.status === 404) {
    throw new MarketplaceSourceError(
      `${PACKAGE}@${serverVersion} is not published; the catalogue for this server's release is not available yet`,
      "not-found",
    );
  }
  if (!response.ok) {
    throw new MarketplaceSourceError(`the npm CDN answered ${response.status} for ${PACKAGE}@${serverVersion}`, "unreachable");
  }
  const listing = (await response.json()) as FlatListing;
  // jsdelivr names files with a leading slash.
  const files = listing.files.map((file) => ({ path: file.name.replace(/^\//, ""), size: file.size }));
  if (files.length > MARKETPLACE_TREE_LIMITS.entries) {
    throw new MarketplaceSourceError(
      `${PACKAGE}@${serverVersion} holds ${files.length} files, over the ${MARKETPLACE_TREE_LIMITS.entries} a marketplace may carry`,
      "too-large",
    );
  }
  const sizes = new Map(files.map((file) => [file.path, file.size]));
  return {
    describe: `${PACKAGE}@${serverVersion}`,
    files,
    fetchFile: async (path) => {
      let content: Response;
      try {
        content = await fetchImpl(officialFileUrl(serverVersion, path));
      } catch (error) {
        throw new MarketplaceSourceError(
          `could not read '${path}' from the npm CDN: ${error instanceof Error ? error.message : String(error)}`,
          "unreachable",
        );
      }
      if (!content.ok) {
        throw new MarketplaceSourceError(`the npm CDN answered ${content.status} for '${path}'`, "unreachable");
      }
      const bytes = new Uint8Array(await content.arrayBuffer());
      const declared = sizes.get(path);
      if (declared !== undefined && bytes.length !== declared) {
        throw new MarketplaceSourceError(
          `'${path}' came back ${bytes.length} bytes where the listing said ${declared}`,
          "refused",
        );
      }
      return bytes;
    },
    fileUrl: (path) => officialFileUrl(serverVersion, path),
  };
}

/**
 * The GitHub account the official catalogue is published from
 * (`github.com/stigmer/stigmer`, `plugins/`), so its mark follows the one
 * rule every source's mark follows: the publisher's own avatar.
 */
export const OFFICIAL_PUBLISHER = "stigmer";
