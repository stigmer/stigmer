// A public GitHub repository as a marketplace tree: the zipball of one ref,
// downloaded from codeload and extracted into a directory the one plugin
// walker then reads like any other.
//
// Why a zipball and not `git`: codeload needs no API call, no token and no
// `git` binary, and the tree convention every vendor publishes (Cursor,
// Claude Code, Codex) is "the repository at a ref", which is exactly what a
// zipball is. Why to disk and not in memory: `install` and `push plugin`
// must yield one digest for one tree, and the digest is a function of the
// CLI's gitignore-aware, symlink-skipping walk over a directory. A second,
// in-memory walk with its own rules would be a second identity.
//
// The archive is untrusted input, so it is read the way the server's push
// gate reads one: the shape from the central directory (the shared
// `@stigmer/zip-structure` parser) BEFORE a byte is inflated, entry count and
// total declared size against the caps, every path contained; then each
// entry inflated with node:zlib under its declared size as a hard output cap
// and its CRC verified, because a declaration is a claim and the bytes are
// the fact. That per-entry read mirrors `archive/inflate.ts` in the server,
// its second consumer; when a third appears it moves to `@stigmer/zip-
// structure` beside `crc32`. The caps are set against the three vendors'
// real trees at HEAD (cursor/plugins 4.5 MiB down and 5.5 MiB inflated over
// 1,169 entries; anthropics/claude-code 11.7 / 13.6 / 1,595; openai/codex
// 18.6 / 76.8 / 9,188, its marketplace file at the repository root so the
// whole repository is the tree), with room above the largest.
//
// The peek. A bare `stigmer install <name>` asks every known source whether
// it offers the name, and with the vendors' catalogues built in that would be
// three zipballs (about 35 MiB) per install. `peekGitHubMarketplace` reads
// only the marketplace file instead: the four locations the library knows,
// tried in its precedence, from raw.githubusercontent.com at the ref (no API
// call, no token, no rate budget, the same reasons as the zipball). It
// answers what the file declares; the zipball is then downloaded for the one
// holder and the tree read verifies the entry before anything is installed.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import {
  MARKETPLACE_LOCATIONS,
  type Marketplace,
  type MarketplaceFinding,
  inMemoryPluginFiles,
  isContainedPath,
  readMarketplaceFile,
} from "@stigmer/plugin-package";
import {
  type ZipStructuralEntry,
  crc32,
  parseZipStructure,
} from "@stigmer/zip-structure";
import { CliExitError } from "../errors/cli-exit-error.js";
import { ExitCode } from "../errors/exit-codes.js";
import { log } from "../logger.js";

/** ZIP compression methods this reader opens, the two the platform's gates register. */
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;

/** The caps a repository zipball must fit under; each refusal names the one it hit. */
export const GITHUB_ZIPBALL_LIMITS = {
  /** The compressed archive as downloaded. */
  downloadBytes: 64 * 1024 * 1024,
  /** The sum of every entry's declared uncompressed size. */
  inflatedBytes: 256 * 1024 * 1024,
  /** Files and directories the central directory lists. */
  entries: 20_000,
} as const;

/** The ref codeload serves when none is named: the repository's default branch. */
const DEFAULT_REF = "HEAD";

export interface GitHubTreeSource {
  /** `owner/repo`. */
  readonly repo: string;
  /** Branch, tag or commit; the default branch when absent. */
  readonly ref?: string;
}

export interface FetchGitHubTreeOptions {
  /** Where the tree is written; created if missing. The caller owns its lifetime. */
  readonly destDir: string;
  /** The HTTP client (injectable for tests). */
  readonly fetchImpl?: typeof globalThis.fetch;
}

/** The URL codeload answers with the zipball of `ref` (no API, no token). */
export function zipballUrl(source: GitHubTreeSource): string {
  return `https://codeload.github.com/${source.repo}/zip/${source.ref ?? DEFAULT_REF}`;
}

/** The URL raw.githubusercontent.com serves `path` from at `ref` (no API, no token). */
export function rawFileUrl(source: GitHubTreeSource, path: string): string {
  return `https://raw.githubusercontent.com/${source.repo}/${source.ref ?? DEFAULT_REF}/${path}`;
}

/** What a peek learned: the file as declared, and where it sat. */
export interface PeekedMarketplace {
  readonly marketplace: Marketplace;
  readonly warnings: readonly MarketplaceFinding[];
  /** The marketplace file's path in the tree, the first present in the library's precedence. */
  readonly location: string;
}

export type PeekOutcome =
  | { readonly ok: true; readonly peeked: PeekedMarketplace }
  /** No marketplace file at any of the four locations: the repository is not a marketplace. */
  | { readonly ok: false; readonly kind: "not-a-marketplace" }
  /** A file was found and the library refused it; its sentences travel. */
  | {
      readonly ok: false;
      readonly kind: "refused";
      readonly location: string;
      readonly errors: readonly MarketplaceFinding[];
      readonly warnings: readonly MarketplaceFinding[];
    };

/**
 * Read only the marketplace file of a GitHub source. The four locations are
 * tried in the library's precedence and the first that exists is read as
 * declared (`readMarketplaceFile`: the tree is not consulted). Network and
 * server faults throw a `CliExitError` naming the repository, as the
 * zipball download does; a 404 at every location is the `not-a-marketplace`
 * outcome, not an error, because a bare-name search must say which sources
 * it looked at and move on.
 */
export async function peekGitHubMarketplace(
  source: GitHubTreeSource,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<PeekOutcome> {
  for (const location of Object.values(MARKETPLACE_LOCATIONS)) {
    const bytes = await fetchRawFile(source, location, fetchImpl);
    if (bytes === undefined) continue;
    const outcome = readMarketplaceFile(
      inMemoryPluginFiles(new Map([[location, bytes]])),
    );
    if (!outcome.ok) {
      return {
        ok: false,
        kind: "refused",
        location,
        errors: outcome.errors,
        warnings: outcome.warnings,
      };
    }
    return {
      ok: true,
      peeked: {
        marketplace: outcome.marketplace,
        warnings: outcome.warnings,
        location,
      },
    };
  }
  return { ok: false, kind: "not-a-marketplace" };
}

/** One raw file, or `undefined` when the path does not exist at the ref. */
async function fetchRawFile(
  source: GitHubTreeSource,
  path: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<Uint8Array | undefined> {
  const url = rawFileUrl(source, path);
  let response: Response;
  try {
    response = await fetchImpl(url, { redirect: "follow" });
  } catch (error) {
    throw new CliExitError(
      `could not reach GitHub for ${source.repo}`,
      ExitCode.Connection,
      [
        `URL: ${url}`,
        "Check the network connection and retry.",
        error instanceof Error ? error.message : String(error),
      ],
    );
  }
  if (response.status === 404) return undefined;
  if (!response.ok) {
    throw new CliExitError(
      `GitHub answered ${response.status} for ${source.repo}`,
      ExitCode.Connection,
      [`URL: ${url}`, "Retry; if it persists, the repository or GitHub is unavailable."],
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Download the zipball and extract it into `destDir` with the zipball's
 * single top-level directory (`<repo>-<ref>/`) stripped, so `destDir` IS the
 * repository root. Throws a `CliExitError` naming what refused: the
 * repository, a cap, or an entry that would escape the directory.
 */
export async function fetchGitHubTree(
  source: GitHubTreeSource,
  options: FetchGitHubTreeOptions,
): Promise<void> {
  const bytes = await download(source, options.fetchImpl ?? globalThis.fetch);
  const entries = inspect(bytes, source);

  mkdirSync(options.destDir, { recursive: true });
  for (const entry of entries) {
    const content = inflate(entry, source);
    const target = join(options.destDir, ...entry.relative.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  log.debug("github tree extracted", {
    repo: source.repo,
    ref: source.ref ?? DEFAULT_REF,
    files: entries.length,
  });
}

/**
 * One entry's bytes, inflated under its declared size as the output cap
 * and checked against its CRC. An entry that inflates past what it declared
 * lied about its budget; one whose bytes do not match its CRC is corrupt or
 * tampered; a method neither the server nor Go registers is not opened.
 */
function inflate(entry: PlannedEntry, source: GitHubTreeSource): Uint8Array {
  let content: Uint8Array;
  switch (entry.zip.compressionMethod) {
    case METHOD_STORED:
      content = entry.zip.compressedData;
      break;
    case METHOD_DEFLATED:
      try {
        content = new Uint8Array(
          inflateRawSync(entry.zip.compressedData, {
            maxOutputLength: entry.declaredSize + 1,
          }),
        );
      } catch (error) {
        if (isOutputLengthError(error)) {
          throw refusal(
            source,
            `entry '${entry.relative}' inflated past its declared size`,
          );
        }
        throw refusal(
          source,
          `entry '${entry.relative}' could not be inflated (${error instanceof Error ? error.message : String(error)})`,
        );
      }
      break;
    default:
      throw refusal(
        source,
        `entry '${entry.relative}' uses compression method ${entry.zip.compressionMethod}, which is not supported`,
      );
  }
  if (content.length > entry.declaredSize) {
    throw refusal(
      source,
      `entry '${entry.relative}' inflated past its declared size`,
    );
  }
  if (crc32(content) !== entry.zip.crc32) {
    throw refusal(source, `entry '${entry.relative}' failed its checksum`);
  }
  return content;
}

async function download(
  source: GitHubTreeSource,
  fetchImpl: typeof globalThis.fetch,
): Promise<Uint8Array> {
  const url = zipballUrl(source);
  let response: Response;
  try {
    response = await fetchImpl(url, { redirect: "follow" });
  } catch (error) {
    throw new CliExitError(
      `could not reach GitHub for ${source.repo}`,
      ExitCode.Connection,
      [
        `URL: ${url}`,
        "Check the network connection and retry.",
        error instanceof Error ? error.message : String(error),
      ],
    );
  }
  if (response.status === 404) {
    throw new CliExitError(
      `GitHub has no public repository '${source.repo}'${source.ref === undefined ? "" : ` at ref '${source.ref}'`}`,
      ExitCode.NotFound,
      [
        "Check the owner, the repository name and the ref.",
        "Private repositories are not supported; a marketplace is public content.",
      ],
    );
  }
  if (!response.ok) {
    throw new CliExitError(
      `GitHub answered ${response.status} for ${source.repo}`,
      ExitCode.General,
      [`URL: ${url}`],
    );
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > GITHUB_ZIPBALL_LIMITS.downloadBytes) {
    throw refusal(
      source,
      `the archive is ${mib(declaredLength)}, over the ${mib(GITHUB_ZIPBALL_LIMITS.downloadBytes)} download cap`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > GITHUB_ZIPBALL_LIMITS.downloadBytes) {
    throw refusal(
      source,
      `the archive is ${mib(bytes.length)}, over the ${mib(GITHUB_ZIPBALL_LIMITS.downloadBytes)} download cap`,
    );
  }
  return bytes;
}

// node:zlib's maxOutputLength violation: the output-cap arm.
function isOutputLengthError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (("code" in error &&
      (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") ||
      error.message.includes("maxOutputLength"))
  );
}

/** One file the archive will yield: where it lands, how large it said it is, and its record. */
interface PlannedEntry {
  /** Repository-relative path, the zipball's top directory stripped. */
  readonly relative: string;
  /** The central directory's uncompressed size, the inflate budget. */
  readonly declaredSize: number;
  readonly zip: ZipStructuralEntry;
}

/**
 * The files to extract, in archive order, decided from the central directory
 * alone. Refuses the caps, an entry outside the one top directory, and a
 * path that would escape the destination.
 */
function inspect(bytes: Uint8Array, source: GitHubTreeSource): PlannedEntry[] {
  let structure;
  try {
    structure = parseZipStructure(bytes);
  } catch (error) {
    throw refusal(
      source,
      `the archive is not a readable zip (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  if (structure.length > GITHUB_ZIPBALL_LIMITS.entries) {
    throw refusal(
      source,
      `the archive lists ${structure.length} entries, over the ${GITHUB_ZIPBALL_LIMITS.entries} cap`,
    );
  }
  let inflated = 0;
  for (const entry of structure) inflated += entry.uncompressedSize;
  if (inflated > GITHUB_ZIPBALL_LIMITS.inflatedBytes) {
    throw refusal(
      source,
      `the archive inflates to ${mib(inflated)}, over the ${mib(GITHUB_ZIPBALL_LIMITS.inflatedBytes)} cap`,
    );
  }

  const entries: PlannedEntry[] = [];
  let top: string | undefined;
  for (const entry of structure) {
    const slash = entry.name.indexOf("/");
    const head = slash === -1 ? entry.name : entry.name.slice(0, slash);
    if (top === undefined) top = head;
    if (head !== top) {
      throw refusal(
        source,
        `the archive holds more than one top-level directory ('${top}' and '${head}')`,
      );
    }
    const relative =
      slash === -1 ? "" : entry.name.slice(slash + 1).replace(/\/+$/, "");
    if (relative === "") continue; // the top directory itself
    if (!isContainedPath(relative)) {
      throw refusal(
        source,
        `entry '${entry.name}' would escape the destination directory`,
      );
    }
    if (entry.isDirectory) continue;
    entries.push({
      relative,
      declaredSize: entry.uncompressedSize,
      zip: entry,
    });
  }
  return entries;
}

function refusal(source: GitHubTreeSource, reason: string): CliExitError {
  return new CliExitError(
    `cannot read ${source.repo} as a marketplace: ${reason}`,
    ExitCode.Usage,
    ["A marketplace is a repository tree with a marketplace file at its root."],
  );
}

function mib(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
