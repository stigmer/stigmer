// Shared primitives for acquiring a single executable from a GitHub-release
// `.tar.gz`: release platform/arch mapping, a fetch + gunzip + minimal tar
// reader, optional sha256 verification, and an executable write.
//
// The Temporal CLI downloader (`temporal/download.ts`) builds on this, and any
// future release-binary downloader should too, so the fetch/verify/extract
// contract lives in exactly one place. (The `stigmer-server` Go binary was its
// second consumer until the server became an npm artifact.) The tar reader is a
// tiny POSIX/ustar implementation: no native `tar` dependency, which keeps the
// base install lean.
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

import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { gunzipSync } from "fflate";
import { CliExitError } from "../errors/cli-exit-error.js";
import { ExitCode } from "../errors/exit-codes.js";

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

/** Attempts per download before a transient failure is reported. */
export const DOWNLOAD_ATTEMPTS = 4;

/** The wait before the second attempt; it doubles before each later one (1 s, 2 s, 4 s). */
export const DOWNLOAD_RETRY_BASE_DELAY_MS = 1_000;

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

  const net: Download = { doFetch: src.fetchImpl ?? fetch, sleep: src.sleep ?? delay };
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

/** Lowercase hex sha256 of `bytes`. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// The network a download runs over: the fetch it calls and the wait between attempts.
interface Download {
  doFetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
}

async function fetchBytes(net: Download, url: string, label: string): Promise<Uint8Array> {
  return fetchWithRetry(net, url, label, async (res) => new Uint8Array(await res.arrayBuffer()));
}

async function fetchText(net: Download, url: string, label: string): Promise<string> {
  return fetchWithRetry(net, url, label, (res) => res.text());
}

// One download, with its body read inside the attempt: a connection that drops
// after the headers is as transient as one that never connects, and is retried
// the same way. The error after the last attempt carries the last failure's
// cause, which for Node's fetch is the socket error behind "fetch failed".
async function fetchWithRetry<T>(
  net: Download,
  url: string,
  label: string,
  read: (res: Response) => Promise<T>,
): Promise<T> {
  let lastFailure = "";
  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt++) {
    if (attempt > 1) await net.sleep(DOWNLOAD_RETRY_BASE_DELAY_MS * 2 ** (attempt - 2));

    let res: Response;
    try {
      res = await net.doFetch(url);
    } catch (err) {
      lastFailure = describeFailure(err);
      continue;
    }
    if (!res.ok) {
      if (!isTransientStatus(res.status)) {
        throw new CliExitError(`failed to download ${label}: HTTP ${res.status} from ${url}`, ExitCode.General);
      }
      lastFailure = `HTTP ${res.status}`;
      continue;
    }
    try {
      return await read(res);
    } catch (err) {
      lastFailure = describeFailure(err);
    }
  }
  throw new CliExitError(
    `failed to download ${label} from ${url} after ${DOWNLOAD_ATTEMPTS} attempts: ${lastFailure}`,
    ExitCode.General,
    ["check the network connection, then run the command again"],
  );
}

// A server error or a rate limit may clear on its own; any other status will not.
function isTransientStatus(status: number): boolean {
  return status >= 500 || status === 429;
}

function describeFailure(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  return err.cause instanceof Error ? `${err.message}: ${err.cause.message}` : err.message;
}

/**
 * The sha256 a `shasum`/`sha256sum`-format file records for `filename`, lowercase
 * hex, or "" when the file has no entry for it. Each line is "<hex>  <filename>";
 * `sha256sum -b` writes the filename with a leading "*" (binary mode), which is
 * not part of the name. A release-wide file lists every asset, so the match is
 * by filename, never by position.
 */
export function parseShasum(content: string, filename: string): string {
  for (const line of content.split("\n")) {
    const [hex, name] = line.trim().split(/\s+/, 2);
    if (hex === undefined || name === undefined) continue;
    if (name.replace(/^\*/, "") === filename) return hex.toLowerCase();
  }
  return "";
}

// The archive's basename as the checksum file names it: the last path segment
// of the URL, with any query string already excluded by URL parsing.
function archiveBasename(url: string): string {
  const segments = new URL(url).pathname.split("/");
  return segments[segments.length - 1] ?? "";
}

/**
 * Extract a single regular-file entry whose basename matches `name` from an
 * (uncompressed) tar buffer. Minimal POSIX/ustar reader: 512-byte header blocks,
 * octal size at offset 124, type flag at 156, data padded to 512 bytes.
 */
export function extractTarEntry(buf: Uint8Array, name: string): Uint8Array | null {
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    const entryName = readCString(header, 0, 100);
    if (entryName === "") break; // zero block marks end of archive

    const size = Number.parseInt(readCString(header, 124, 12).trim() || "0", 8) || 0;
    const typeFlag = String.fromCharCode(header[156] ?? 0);
    const dataStart = offset + 512;

    const isRegularFile = typeFlag === "0" || typeFlag === "\0";
    if (isRegularFile && basename(entryName) === name) {
      return buf.subarray(dataStart, dataStart + size);
    }

    // Advance past this entry's data, rounded up to the 512-byte block size.
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return null;
}

function readCString(block: Uint8Array, start: number, length: number): string {
  let end = start;
  const limit = start + length;
  while (end < limit && block[end] !== 0) end += 1;
  return Buffer.from(block.subarray(start, end)).toString("utf8");
}

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}
