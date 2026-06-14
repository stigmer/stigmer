// On-demand download of the Temporal CLI binary from GitHub releases.
//
// `up` needs a `temporal` binary and the upstream release is a small, public,
// stable artifact. The fetch/gunzip/untar/write mechanics are shared with the
// stigmer-server downloader in `../artifact.ts`; this module only owns Temporal's
// asset-naming and the default version.
//
// Parity note: like the Go CLI, this does not verify a checksum (the stigmer
// -server downloader does, per DD-003). A checksum-hardening follow-up is filed;
// until then the integrity guarantee is HTTPS + GitHub's release immutability.

import { existsSync } from "node:fs";
import { fetchTarballBinary, mapReleaseArch, mapReleaseOs } from "../artifact.js";

// Re-exported so existing consumers (temporal/index.ts, download.test.ts) keep
// importing the tar reader from here.
export { extractTarEntry } from "../artifact.js";

/** Default Temporal CLI version (matches the Go CLI's `DefaultTemporalVersion`). */
export const DEFAULT_TEMPORAL_VERSION = "1.5.1";

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

/** Download and install the Temporal CLI binary to `binPath`. */
export async function downloadTemporalCli(target: TemporalDownloadTarget): Promise<void> {
  const goos = mapReleaseOs(target.platform ?? process.platform);
  const goarch = mapReleaseArch(target.arch ?? process.arch);
  const archive = `temporal_cli_${target.version}_${goos}_${goarch}.tar.gz`;
  const url = `https://github.com/temporalio/cli/releases/download/v${target.version}/${archive}`;

  await fetchTarballBinary({
    url,
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
