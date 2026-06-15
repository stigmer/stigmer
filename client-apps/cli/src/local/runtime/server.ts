// Resolution and on-demand acquisition of the `stigmer-server` control plane.
//
// DD-003: a TypeScript CLI cannot `go:embed` a Go binary, so it resolves an
// existing `stigmer-server` (dev build / Homebrew / a prior download) and, when
// none is present, downloads the standalone release asset into ~/.stigmer/bin and
// verifies its sha256 before first use. The fetch/extract mechanics are shared
// with the Temporal downloader (`../artifact.ts`); the one deliberate difference
// is the checksum step — this is our own executable, and DD-003 makes integrity
// non-negotiable.
//
// Resolution order (first existing hit wins; download is the last resort):
//   1. STIGMER_SERVER_BIN — explicit override (tests, custom installs)
//   2. repo `bin/stigmer-server` — the dev build (`make build`)
//   3. ~/bin/stigmer-server — a common local install location
//   4. ~/.stigmer/bin/stigmer-server — a previously-downloaded release asset
//   5. PATH — `stigmer-server`
//   6. download the pinned release asset into ~/.stigmer/bin (checksum-verified)

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CliExitError } from "../../errors/cli-exit-error.js";
import { ExitCode } from "../../errors/exit-codes.js";
import { VERSION } from "../../version.js";
import { fetchTarballBinary, mapReleaseArch, mapReleaseOs } from "../artifact.js";
import { binDir } from "../paths.js";
import { which } from "./which.js";

const SERVER_BINARY = "stigmer-server";
const GITHUB_REPO = "stigmer/stigmer";

// Platform/arch combos for which `release.cli.yaml` publishes a stigmer-server
// asset. The npm CLI installs on more platforms than this (e.g. linux-arm64,
// Windows), so an unsupported `stigmer up` must fail with clear guidance rather
// than a confusing 404.
const SUPPORTED_PLATFORMS = new Set(["darwin-arm64", "darwin-amd64", "linux-amd64"]);

/**
 * Find an already-present `stigmer-server` binary, or null. Pure: never
 * downloads. `home` is injectable for tests.
 */
export function resolveServerBinary(home: string = homedir()): string | null {
  for (const candidate of serverCandidates(home)) {
    if (existsSync(candidate)) return candidate;
  }
  return which(SERVER_BINARY);
}

export interface EnsureServerOptions {
  home?: string;
  /** Release version to download if needed (defaults to the CLI's own version). */
  version?: string;
  /** Override the fetch implementation (tests). */
  fetchImpl?: typeof fetch;
}

/**
 * Ensure a `stigmer-server` binary is available, returning its path. Reuses an
 * existing binary if found; otherwise downloads the pinned release asset into
 * ~/.stigmer/bin (checksum-verified). Throws actionable guidance when no binary
 * exists and a download is not possible (a source/dev build, or an unsupported
 * platform).
 */
export async function ensureServerBinary(opts: EnsureServerOptions = {}): Promise<string> {
  const home = opts.home ?? homedir();
  const existing = resolveServerBinary(home);
  if (existing !== null) return existing;

  const version = opts.version ?? VERSION;
  if (!isDownloadableRelease(version)) {
    throw notFoundError();
  }

  const binPath = join(binDir(home), SERVER_BINARY);
  await downloadServerBinary({ version, binPath, fetchImpl: opts.fetchImpl });
  return binPath;
}

export interface ServerDownloadTarget {
  /** Release version, e.g. "0.5.0" or "0.5.0-rc.1" (with or without a leading "v"). */
  version: string;
  /** Absolute path to write the extracted `stigmer-server` binary to. */
  binPath: string;
  /** Node platform (defaults to process.platform). */
  platform?: NodeJS.Platform;
  /** Node arch (defaults to process.arch). */
  arch?: string;
  /** Override the fetch implementation (tests). */
  fetchImpl?: typeof fetch;
}

/**
 * Download, checksum-verify, and install the standalone `stigmer-server` release
 * asset. Throws a {@link CliExitError} on an unsupported platform or any
 * network/checksum/extraction failure.
 */
export async function downloadServerBinary(target: ServerDownloadTarget): Promise<void> {
  const os = mapReleaseOs(target.platform ?? process.platform);
  const arch = mapReleaseArch(target.arch ?? process.arch);
  const platformKey = `${os}-${arch}`;
  if (!SUPPORTED_PLATFORMS.has(platformKey)) {
    throw unsupportedPlatformError(platformKey);
  }

  const tag = releaseTag(target.version);
  const archive = `${SERVER_BINARY}-${tag}-${platformKey}.tar.gz`;
  const url = `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${archive}`;

  await fetchTarballBinary({
    url,
    checksumUrl: `${url}.sha256`,
    entryName: SERVER_BINARY,
    binPath: target.binPath,
    label: SERVER_BINARY,
    fetchImpl: target.fetchImpl,
  });
}

function serverCandidates(home: string): string[] {
  const candidates: string[] = [];
  const override = process.env.STIGMER_SERVER_BIN;
  if (override !== undefined && override !== "") candidates.push(override);

  const root = repoRoot();
  if (root !== null) candidates.push(join(root, "bin", SERVER_BINARY));
  candidates.push(join(home, "bin", SERVER_BINARY));
  candidates.push(join(binDir(home), SERVER_BINARY)); // a previously-downloaded asset
  return candidates;
}

// Only tagged releases publish a downloadable asset. A source build reports the
// "0.0.0-dev" sentinel and the dev npm channel stamps "<v>-dev.<stamp>" versions
// (release.dev.yaml) that never cut a GitHub release — neither is downloadable.
function isDownloadableRelease(version: string): boolean {
  return !version.includes("-dev");
}

// The npm package version maps to the GitHub release tag by prefixing "v"
// (npm 0.5.0 -> tag v0.5.0; npm 0.5.0-rc.1 -> tag v0.5.0-rc.1).
function releaseTag(version: string): string {
  return version.startsWith("v") ? version : `v${version}`;
}

function notFoundError(): CliExitError {
  return new CliExitError(`${SERVER_BINARY} binary not found`, ExitCode.General, [
    "Build it from the repo with `make build` (produces ./bin/stigmer-server),",
    "or set STIGMER_SERVER_BIN to an existing binary.",
    "Automatic download is only available for tagged releases.",
  ]);
}

function unsupportedPlatformError(platformKey: string): CliExitError {
  return new CliExitError(`the local stack does not support this platform (${platformKey})`, ExitCode.General, [
    "`stigmer up` needs a stigmer-server release asset, which is published for",
    "macOS (arm64/amd64) and Linux (amd64) only.",
    "Point STIGMER_SERVER_BIN at a server binary you built yourself to proceed.",
  ]);
}

// Walk up from this module to the repo root (the directory containing
// `bin/stigmer-server` in a dev checkout). Returns null outside a checkout.
function repoRoot(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, "bin", SERVER_BINARY))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
