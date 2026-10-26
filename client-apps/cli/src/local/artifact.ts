// Acquiring a single executable from a GitHub-release `.tar.gz`: release
// platform/arch mapping, the cache below, and the CLI's exit errors, over the
// download contract in `@stigmer/artifact-fetch` (the retry rules, the digest
// check, the tar reader), which the runner shares for the Claude engine.
//
// The Temporal CLI downloader (`temporal/download.ts`) builds on this, and any
// future release-binary downloader should too. (The `stigmer-server` Go binary
// was its second consumer until the server became an npm artifact.)
//
// Retrying a transient failure is part of the contract. A connection that resets
// before or during the body, a 5xx or a 429 is tried again with a doubling wait,
// so a network blip does not fail a first `stigmer up`, a CI lane or an image
// build. Any other HTTP status and a checksum mismatch are answers: they fail at
// once.
//
// A caller may also name a cache directory, where a verified archive is kept
// beside the checksum file it was verified against. The cache is read before the
// network and must pass the same digest comparison a download does; a pair that
// is absent or does not match is downloaded again, as if there were no cache. A
// retry covers seconds, and a release host can be down for minutes: the cache is
// what lets a CI lane install through such an outage. It is an option, not a
// default: a user's machine already keeps the binary it installed, so
// `stigmer up` and the image staging pass none.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  ArtifactFetchError,
  describeFailure,
  extractTarEntry,
  fetchWithRetry,
  network,
  parseShasum,
  sha256Hex,
  type Network,
} from "@stigmer/artifact-fetch";
import { gunzipSync } from "fflate";
import { CliExitError } from "../errors/cli-exit-error.js";
import { ExitCode } from "../errors/exit-codes.js";

export { DOWNLOAD_ATTEMPTS, DOWNLOAD_RETRY_BASE_DELAY_MS, extractTarEntry, parseShasum, sha256Hex } from "@stigmer/artifact-fetch";

/** Release OS token, matching the `<os>` segment of our release asset names. */
export function mapReleaseOs(platform: NodeJS.Platform): string {
  switch (platform) {
    case "darwin":
      return "darwin";
    case "win32":
      return "windows";
    default:
      return "linux";
  }
}

/** Release arch token, matching the `<arch>` segment of our release asset names. */
export function mapReleaseArch(arch: string): string {
  switch (arch) {
    case "arm64":
      return "arm64";
    case "x64":
      return "amd64";
    default:
      return arch;
  }
}

export interface TarballBinarySource {
  /** URL of the `.tar.gz` archive. */
  url: string;
  /**
   * URL of a `shasum -a 256`-format checksum file covering {@link url}. The
   * file may list many assets (a release's `checksums.txt`); the line whose
   * filename is the archive's basename is the one that counts. When set, the
   * downloaded archive's sha256 is verified against it before extraction and
   * any mismatch — or a file with no entry for the archive — aborts the install.
   */
  checksumUrl?: string;
  /** Basename of the entry to extract from the archive. */
  entryName: string;
  /** Absolute path to write the extracted, executable binary to. */
  binPath: string;
  /** Human label used in error messages (e.g. "Temporal CLI", "stigmer-server"). */
  label: string;
  /**
   * A directory that keeps the verified archive and its checksum file between
   * installs (see the module header). Used only with {@link checksumUrl}: an
   * archive nothing verified is never cached. Created when missing; a failure to
   * write it fails the install.
   */
  cacheDir?: string;
  /** Override the fetch implementation (tests). */
  fetchImpl?: typeof fetch;
  /** Override the wait between download attempts (tests). */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Why the cache did not serve an install that went to the network: no cache
 * directory was in use, it held no copy of this archive, or its copy did not
 * match its checksum line.
 */
export type CacheMiss = "unused" | "absent" | "mismatch";

/** Where the installed binary came from. */
export type TarballInstall = { source: "cache" } | { source: "network"; cache: CacheMiss };

/**
 * Install the named entry of a `.tar.gz` at `binPath` with executable
 * permissions: from the cache directory when it holds a copy that matches its
 * checksum line, otherwise downloaded, verified when a checksum URL is given,
 * and then written to the cache. Transient network failures are retried (see
 * the module header). Throws a {@link CliExitError} with the URL on a persistent
 * network failure, a non-transient HTTP status, a checksum mismatch or an
 * extraction failure, and with the path when the cache cannot be read or written.
 */
export async function fetchTarballBinary(src: TarballBinarySource): Promise<TarballInstall> {
  const archiveName = archiveBasename(src.url);
  const cache =
    src.checksumUrl === undefined || src.cacheDir === undefined
      ? undefined
      : cachePaths(src.cacheDir, archiveName, archiveBasename(src.checksumUrl));

  let miss: CacheMiss = "unused";
  if (cache !== undefined) {
    const cached = readCachedPair(cache, src.label);
    if (cached === null) {
      miss = "absent";
    } else if (compareDigest(cached.archive, cached.checksums, archiveName).matches) {
      installEntry(cached.archive, src, cache.archive);
      return { source: "cache" };
    } else {
      miss = "mismatch";
    }
  }

  const net = network({ fetchImpl: src.fetchImpl, sleep: src.sleep });
  const archive = await fetchBytes(net, src.url, src.label);
  let checksums: string | undefined;
  if (src.checksumUrl !== undefined) {
    checksums = await fetchText(net, src.checksumUrl, `${src.label} checksum`);
    const { matches, expected, actual } = compareDigest(archive, checksums, archiveName);
    if (!matches) {
      throw new CliExitError(`${src.label} checksum mismatch — refusing to use the download`, ExitCode.General, [
        `expected: ${expected || `(no entry for ${archiveName} in ${src.checksumUrl})`}`,
        `actual:   ${actual}`,
        `archive:  ${src.url}`,
      ]);
    }
  }

  installEntry(archive, src, src.url);
  if (cache !== undefined && checksums !== undefined) writeCachedPair(cache, archive, checksums, src.label);
  return { source: "network", cache: miss };
}

// The one comparison a downloaded archive and a cached one both pass: the
// archive's sha256 against the line its checksum file keeps for its name. A file
// with no line for the archive never matches.
function compareDigest(
  archive: Uint8Array,
  checksums: string,
  archiveName: string,
): { matches: boolean; expected: string; actual: string } {
  const expected = parseShasum(checksums, archiveName);
  const actual = sha256Hex(archive);
  return { matches: expected !== "" && expected === actual, expected, actual };
}

// Extract the entry from verified archive bytes and write it executable.
// `origin` is where the bytes came from (the URL, or the cached file), so an
// archive without the entry is reported against the copy that lacked it.
function installEntry(archive: Uint8Array, src: TarballBinarySource, origin: string): void {
  const tarBytes = gunzipSync(archive);
  const binary = extractTarEntry(tarBytes, src.entryName);
  if (binary === null) {
    throw new CliExitError(`${src.entryName} not found in the ${src.label} archive`, ExitCode.General, [
      `archive: ${origin}`,
    ]);
  }

  mkdirSync(dirname(src.binPath), { recursive: true });
  writeFileSync(src.binPath, binary, { mode: 0o755 });
  chmodSync(src.binPath, 0o755);
}

// A cached pair is named by the archive, which carries the version, so an entry
// left by another version is simply absent: `<archive>` and
// `<archive>.<checksum file>` (for Temporal, `…tar.gz.checksums.txt`).
interface CachePaths {
  archive: string;
  checksums: string;
}

function cachePaths(dir: string, archiveName: string, checksumName: string): CachePaths {
  return { archive: join(dir, archiveName), checksums: join(dir, `${archiveName}.${checksumName}`) };
}

function readCachedPair(paths: CachePaths, label: string): { archive: Uint8Array; checksums: string } | null {
  if (!existsSync(paths.archive) || !existsSync(paths.checksums)) return null;
  try {
    return { archive: new Uint8Array(readFileSync(paths.archive)), checksums: readFileSync(paths.checksums, "utf8") };
  } catch (err) {
    throw new CliExitError(`could not read the cached ${label}`, ExitCode.General, [
      `path:  ${dirname(paths.archive)}`,
      `cause: ${describeFailure(err)}`,
    ]);
  }
}

function writeCachedPair(paths: CachePaths, archive: Uint8Array, checksums: string, label: string): void {
  try {
    mkdirSync(dirname(paths.archive), { recursive: true });
    writeFileSync(paths.archive, archive);
    writeFileSync(paths.checksums, checksums);
  } catch (err) {
    throw new CliExitError(`could not write the ${label} cache`, ExitCode.General, [
      `path:  ${dirname(paths.archive)}`,
      `cause: ${describeFailure(err)}`,
    ]);
  }
}

async function fetchBytes(net: Network, url: string, label: string): Promise<Uint8Array> {
  return asExitError(() => fetchWithRetry(net, url, label, async (res) => new Uint8Array(await res.arrayBuffer())));
}

async function fetchText(net: Network, url: string, label: string): Promise<string> {
  return asExitError(() => fetchWithRetry(net, url, label, (res) => res.text()));
}

// The library's failures, as the CLI's exit error with the same message and hints.
async function asExitError<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    throw err instanceof ArtifactFetchError ? new CliExitError(err.message, ExitCode.General, err.details.length > 0 ? err.details : undefined) : err;
  }
}

// The archive's basename as the checksum file names it: the last path segment
// of the URL, with any query string already excluded by URL parsing.
function archiveBasename(url: string): string {
  const segments = new URL(url).pathname.split("/");
  return segments[segments.length - 1] ?? "";
}
