// On-demand download of the Temporal CLI binary from GitHub releases.
//
// `up` needs a `temporal` binary and the upstream release is a small, public,
// stable artifact. The fetch/gunzip/untar/write mechanics are shared with the
// other release downloaders in `../artifact.ts`; this module owns Temporal's
// asset-naming, the default version, and reading the version an installed
// binary reports, which is how `up` knows to move a machine to a new pin.
//
// Every download is verified against the release's `checksums.txt` (the
// `sha256sum` file Temporal publishes beside its archives) before the binary is
// written: the integrity guarantee is the published digest, not merely HTTPS
// plus GitHub's release immutability. The same code path stages the binary the
// all-in-one image bakes, so one pin and one verification serve every channel.

import { execFileSync } from "node:child_process";
import { fetchTarballBinary, mapReleaseArch, mapReleaseOs, type TarballInstall } from "../artifact.js";

// Re-exported so existing consumers (temporal/index.ts, download.test.ts) keep
// importing the tar reader from here.
export { extractTarEntry } from "../artifact.js";
export type { CacheMiss, TarballInstall } from "../artifact.js";

/**
 * The Temporal CLI version every channel runs: `stigmer up`, the all-in-one
 * image, and the CI lanes and developer machines that install it with
 * `make install-temporal-cli`. Bump it deliberately; it moves all of them, and
 * `stigmer up` replaces a ~/.stigmer/bin binary that reports another version.
 */
export const DEFAULT_TEMPORAL_VERSION = "1.10.0";

/** The release's `sha256sum`-format digest file, one line per published asset. */
export const TEMPORAL_CHECKSUMS_FILE = "checksums.txt";

export interface TemporalDownloadTarget {
  /** Temporal CLI version, e.g. "1.10.0". */
  version: string;
  /** Absolute path to write the extracted `temporal` binary to. */
  binPath: string;
  /** Node platform (defaults to process.platform). */
  platform?: NodeJS.Platform;
  /** Node arch (defaults to process.arch). */
  arch?: string;
  /**
   * A directory that keeps the verified archive and its `checksums.txt` between
   * installs, so a CI lane installs without the release host (`artifact.ts`).
   */
  cacheDir?: string;
  /** Override the fetch implementation (tests). */
  fetchImpl?: typeof fetch;
  /** Override the wait between download attempts (tests). */
  sleep?: (ms: number) => Promise<void>;
}

/** The release asset name for a version on a platform, as Temporal publishes it. */
export function temporalArchiveName(version: string, platform: NodeJS.Platform, arch: string): string {
  return `temporal_cli_${version}_${mapReleaseOs(platform)}_${mapReleaseArch(arch)}.tar.gz`;
}

/** The GitHub release download URL for one asset of a version. */
export function temporalReleaseAssetUrl(version: string, asset: string): string {
  return `https://github.com/temporalio/cli/releases/download/v${version}/${asset}`;
}

/**
 * Install the verified Temporal CLI binary to `binPath`, from `cacheDir` when it
 * holds a matching copy, otherwise downloaded; says which.
 */
export async function downloadTemporalCli(target: TemporalDownloadTarget): Promise<TarballInstall> {
  const archive = temporalArchiveName(target.version, target.platform ?? process.platform, target.arch ?? process.arch);

  return fetchTarballBinary({
    url: temporalReleaseAssetUrl(target.version, archive),
    checksumUrl: temporalReleaseAssetUrl(target.version, TEMPORAL_CHECKSUMS_FILE),
    entryName: "temporal",
    binPath: target.binPath,
    label: "Temporal CLI",
    cacheDir: target.cacheDir,
    fetchImpl: target.fetchImpl,
    sleep: target.sleep,
  });
}

// `temporal --version` answers in about 40 ms once warm; a binary's first run
// on macOS waits for the system's scan of a new executable (1.3 to 1.8 s
// measured), so the limit leaves room for a slow machine without hanging `up`.
const VERSION_TIMEOUT_MS = 10_000;

// The CLI's version line: `temporal version 1.10.0 (Server 1.32.2, UI 2.56.1)`.
const VERSION_LINE = /^temporal version (\S+)/;

/**
 * The version the Temporal CLI at `binPath` reports, or null when there is no
 * binary, it fails or times out, or it prints anything but its version line.
 */
export function installedTemporalVersion(binPath: string): string | null {
  try {
    const out = execFileSync(binPath, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: VERSION_TIMEOUT_MS,
    });
    return VERSION_LINE.exec(out.trim())?.[1] ?? null;
  } catch {
    return null;
  }
}
