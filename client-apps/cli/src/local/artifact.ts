// Shared primitives for acquiring a single executable from a GitHub-release
// `.tar.gz`: release platform/arch mapping, a fetch + gunzip + minimal tar
// reader, optional sha256 verification, and an executable write.
//
// The Temporal CLI downloader (`temporal/download.ts`) builds on this, and any
// future release-binary downloader should too, so the fetch/verify/extract
// contract lives in exactly one place. (The `stigmer-server` Go binary was its
// second consumer until the server became an npm artifact.) The tar reader is a
// tiny POSIX/ustar implementation: no native `tar` dependency, which keeps the
// base install lean (DD-002).

import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
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
  /** Override the fetch implementation (tests). */
  fetchImpl?: typeof fetch;
}

/**
 * Download a `.tar.gz`, optionally verify its sha256, extract the named entry,
 * and write it to `binPath` with executable permissions. Throws a
 * {@link CliExitError} with the URL on any network, checksum, or extraction
 * failure.
 */
export async function fetchTarballBinary(src: TarballBinarySource): Promise<void> {
  const doFetch = src.fetchImpl ?? fetch;
  const archive = await fetchBytes(doFetch, src.url, src.label);

  if (src.checksumUrl !== undefined) {
    const archiveName = archiveBasename(src.url);
    const expected = parseShasum(await fetchText(doFetch, src.checksumUrl, `${src.label} checksum`), archiveName);
    const actual = sha256Hex(archive);
    if (expected === "" || expected !== actual) {
      throw new CliExitError(`${src.label} checksum mismatch — refusing to use the download`, ExitCode.General, [
        `expected: ${expected || `(no entry for ${archiveName} in ${src.checksumUrl})`}`,
        `actual:   ${actual}`,
        `archive:  ${src.url}`,
      ]);
    }
  }

  const tarBytes = gunzipSync(archive);
  const binary = extractTarEntry(tarBytes, src.entryName);
  if (binary === null) {
    throw new CliExitError(`${src.entryName} not found in the downloaded ${src.label} archive`, ExitCode.General, [
      `archive: ${src.url}`,
    ]);
  }

  mkdirSync(dirname(src.binPath), { recursive: true });
  writeFileSync(src.binPath, binary, { mode: 0o755 });
  chmodSync(src.binPath, 0o755);
}

/** Lowercase hex sha256 of `bytes`. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fetchBytes(doFetch: typeof fetch, url: string, label: string): Promise<Uint8Array> {
  const res = await doFetchOrThrow(doFetch, url, label);
  return new Uint8Array(await res.arrayBuffer());
}

async function fetchText(doFetch: typeof fetch, url: string, label: string): Promise<string> {
  const res = await doFetchOrThrow(doFetch, url, label);
  return res.text();
}

async function doFetchOrThrow(doFetch: typeof fetch, url: string, label: string): Promise<Response> {
  let res: Response;
  try {
    res = await doFetch(url);
  } catch (err) {
    throw new CliExitError(`failed to download ${label} from ${url}`, ExitCode.General, [String(err)]);
  }
  if (!res.ok) {
    throw new CliExitError(`failed to download ${label}: HTTP ${res.status} from ${url}`, ExitCode.General);
  }
  return res;
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
