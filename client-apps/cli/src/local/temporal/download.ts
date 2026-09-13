// On-demand download of the Temporal CLI binary from GitHub releases.
//
// `up` needs a `temporal` binary and the upstream release is a small, public,
// stable artifact. The fetch/gunzip/untar/write mechanics are shared with the
// other release downloaders in `../artifact.ts`; this module only owns
// Temporal's asset-naming and the default version.
//
// Every download is verified against the release's `checksums.txt` (the
// `sha256sum` file Temporal publishes beside its archives) before the binary is
// written: the integrity guarantee is the published digest, not merely HTTPS
// plus GitHub's release immutability. The same code path stages the binary the
// all-in-one image bakes, so one pin and one verification serve every channel.

import { existsSync } from "node:fs";
import { fetchTarballBinary, mapReleaseArch, mapReleaseOs } from "../artifact.js";

// Re-exported so existing consumers (temporal/index.ts, download.test.ts) keep
// importing the tar reader from here.
export { extractTarEntry } from "../artifact.js";

/** Default Temporal CLI version (matches the Go CLI's `DefaultTemporalVersion`). */
export const DEFAULT_TEMPORAL_VERSION = "1.5.1";

/** The release's `sha256sum`-format digest file, one line per published asset. */
export const TEMPORAL_CHECKSUMS_FILE = "checksums.txt";

export interface TemporalDownloadTarget {
  /** Temporal CLI version, e.g. "1.5.1". */
  version: string;
  /** Absolute path to write the extracted `temporal` binary to. */
  binPath: string;
  /** Node platform (defaults to process.platform). */
  platform?: NodeJS.Platform;
  /** Node arch (defaults to process.arch). */
  arch?: string;
  /** Override the fetch implementation (tests). */
  fetchImpl?: typeof fetch;
}

/** The release asset name for a version on a platform, as Temporal publishes it. */
export function temporalArchiveName(version: string, platform: NodeJS.Platform, arch: string): string {
  return `temporal_cli_${version}_${mapReleaseOs(platform)}_${mapReleaseArch(arch)}.tar.gz`;
}

/** The GitHub release download URL for one asset of a version. */
export function temporalReleaseAssetUrl(version: string, asset: string): string {
  return `https://github.com/temporalio/cli/releases/download/v${version}/${asset}`;
}

/** Download, verify and install the Temporal CLI binary to `binPath`. */
export async function downloadTemporalCli(target: TemporalDownloadTarget): Promise<void> {
  const archive = temporalArchiveName(target.version, target.platform ?? process.platform, target.arch ?? process.arch);

  await fetchTarballBinary({
    url: temporalReleaseAssetUrl(target.version, archive),
    checksumUrl: temporalReleaseAssetUrl(target.version, TEMPORAL_CHECKSUMS_FILE),
    entryName: "temporal",
    binPath: target.binPath,
    label: "Temporal CLI",
    fetchImpl: target.fetchImpl,
  });
}

/** True if a Temporal binary is already present at `binPath`. */
export function isTemporalInstalled(binPath: string): boolean {
  return existsSync(binPath);
}
