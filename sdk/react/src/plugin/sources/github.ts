/**
 * A public GitHub repository as a marketplace tree, read from a browser.
 *
 * The CLI downloads a codeload zipball; a browser cannot (codeload answers
 * CORS only to GitHub's own origin). What a browser can read: the Git
 * Trees API (`api.github.com`, `access-control-allow-origin: *`) and raw
 * file content (`raw.githubusercontent.com`, likewise). So the console
 * lists the tree once, recursively, at the requested ref, and reads each
 * file it needs at the COMMIT the listing resolved to, so listing and
 * reads describe one tree, as the CLI's zipball does.
 *
 * The unauthenticated API budget is 60 requests per hour per client IP,
 * and a conditional request answered `304 Not Modified` is not counted
 * against it. The listing is cached per repository and ref for the
 * lifetime of the module with its ETag, and re-asked conditionally, so
 * browsing a marketplace costs one listing and the entry's own files.
 *
 * A `truncated` listing (GitHub stops at 100,000 entries or 7 MB) is
 * refused outright: a partial tree would select a partial plugin and
 * push a wrong digest. Every vendor's marketplace is well under the
 * limit; a repository that is not is not a marketplace this console
 * reads.
 */

import { type GitHubMarketplaceSource, describeGitHubSource } from "@stigmer/plugin-package/client";

import {
  type FetchImpl,
  MARKETPLACE_TREE_LIMITS,
  MarketplaceSourceError,
  type MarketplaceTree,
} from "./types.js";

/** The ref the API resolves when none is named: the default branch. */
const DEFAULT_REF = "HEAD";

interface TreeListing {
  readonly sha: string;
  readonly tree: readonly {
    readonly path: string;
    readonly type: "blob" | "tree" | "commit";
    readonly size?: number;
  }[];
  readonly truncated: boolean;
}

interface CachedListing {
  readonly etag: string | null;
  readonly listing: TreeListing;
}

const listingCache = new Map<string, CachedListing>();

/** For tests: forget every cached listing. */
export function resetGitHubListingCache(): void {
  listingCache.clear();
}

/** The Trees API URL for `source` (one call, recursive). */
export function treesUrl(source: GitHubMarketplaceSource): string {
  return `https://api.github.com/repos/${source.repo}/git/trees/${encodeURIComponent(source.ref ?? DEFAULT_REF)}?recursive=1`;
}

/** The raw content URL of `path` at `commit`. */
export function rawUrl(repo: string, commit: string, path: string): string {
  return `https://raw.githubusercontent.com/${repo}/${commit}/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** Open the repository at its ref as a tree the reader can select from. */
export async function openGitHubTree(
  source: GitHubMarketplaceSource,
  fetchImpl: FetchImpl,
): Promise<MarketplaceTree> {
  const listing = await fetchListing(source, fetchImpl);
  if (listing.truncated) {
    throw new MarketplaceSourceError(
      `${describeGitHubSource(source)} lists more files than GitHub returns in one tree, so it cannot be read as a marketplace`,
      "too-large",
    );
  }
  const files = listing.tree
    .filter((entry) => entry.type === "blob")
    .map((entry) => ({ path: entry.path, size: entry.size ?? 0 }));
  if (files.length > MARKETPLACE_TREE_LIMITS.entries) {
    throw new MarketplaceSourceError(
      `${describeGitHubSource(source)} holds ${files.length} files, over the ${MARKETPLACE_TREE_LIMITS.entries} a marketplace may carry`,
      "too-large",
    );
  }
  const commit = listing.sha;
  const sizes = new Map(files.map((file) => [file.path, file.size]));
  return {
    describe: `${describeGitHubSource(source)} (${commit.slice(0, 7)})`,
    files,
    fetchFile: (path) => fetchRaw(source.repo, commit, path, sizes.get(path), fetchImpl),
    fileUrl: (path) => rawUrl(source.repo, commit, path),
  };
}

/**
 * The public avatar of the GitHub account `owner`, at a size a chip or a
 * card mark renders. This is how a source is identified visually: the
 * account that publishes a catalogue shows its own picture, for the
 * built-in vendors and for any repository a user adds alike, so the SDK
 * ships no vendor artwork and a new source needs no new asset.
 */
export function githubAvatarUrl(owner: string, size = 64): string {
  return `https://github.com/${encodeURIComponent(owner)}.png?size=${size}`;
}

/** The account half of an `owner/repo` slug. */
export function githubOwner(repo: string): string {
  const slash = repo.indexOf("/");
  return slash === -1 ? repo : repo.slice(0, slash);
}

async function fetchListing(source: GitHubMarketplaceSource, fetchImpl: FetchImpl): Promise<TreeListing> {
  const key = `${source.repo}@${source.ref ?? DEFAULT_REF}`;
  const cached = listingCache.get(key);
  const headers: Record<string, string> = { accept: "application/vnd.github+json" };
  if (cached?.etag) headers["if-none-match"] = cached.etag;

  let response: Response;
  try {
    response = await fetchImpl(treesUrl(source), { headers });
  } catch (error) {
    throw new MarketplaceSourceError(
      `could not reach GitHub for ${describeGitHubSource(source)}: ${error instanceof Error ? error.message : String(error)}`,
      "unreachable",
    );
  }
  if (response.status === 304 && cached !== undefined) return cached.listing;
  if (response.status === 404) {
    throw new MarketplaceSourceError(
      `GitHub has no public repository ${describeGitHubSource(source)}; private repositories are not marketplaces`,
      "not-found",
    );
  }
  if (response.status === 403 || response.status === 429) {
    throw new MarketplaceSourceError(
      `GitHub is rate-limiting this browser (${response.status}); try again in a while, or install with the CLI`,
      "unreachable",
    );
  }
  if (!response.ok) {
    throw new MarketplaceSourceError(
      `GitHub answered ${response.status} for ${describeGitHubSource(source)}`,
      "unreachable",
    );
  }
  const listing = (await response.json()) as TreeListing;
  listingCache.set(key, { etag: response.headers.get("etag"), listing });
  return listing;
}

async function fetchRaw(
  repo: string,
  commit: string,
  path: string,
  declaredSize: number | undefined,
  fetchImpl: FetchImpl,
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetchImpl(rawUrl(repo, commit, path));
  } catch (error) {
    throw new MarketplaceSourceError(
      `could not read '${path}' from GitHub: ${error instanceof Error ? error.message : String(error)}`,
      "unreachable",
    );
  }
  if (!response.ok) {
    throw new MarketplaceSourceError(`GitHub answered ${response.status} for '${path}'`, "unreachable");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  // The listing declared the size; a body of another length is not the file the listing described.
  if (declaredSize !== undefined && bytes.length !== declaredSize) {
    throw new MarketplaceSourceError(
      `'${path}' came back ${bytes.length} bytes where the tree listed ${declaredSize}; the repository changed under the read`,
      "refused",
    );
  }
  return bytes;
}
