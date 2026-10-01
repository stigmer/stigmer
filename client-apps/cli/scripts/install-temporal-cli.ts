// install-temporal-cli writes the Temporal CLI that `stigmer up` runs into a
// directory of the caller's choosing, for the places that need `temporal` on
// PATH without going through `stigmer up`: a developer machine running the
// execution suites, and the CI lanes that run them. Run by
// `make install-temporal-cli`, which writes ~/bin/temporal, and by
// `.github/actions/temporal-cli` in CI.
//
// It calls the product's own downloader, so the version is the pin in
// `src/local/temporal/download.ts`, the archive is verified against the
// release's checksums.txt, and a transient network failure is retried, exactly
// as for a user's first `stigmer up` and the all-in-one image. The suites then
// run against the Temporal users run, not whatever an installer calls latest.
//
// It never trusts a binary already in place (the downloader's
// `isTemporalInstalled` checks only that the file exists), so a rerun after a
// pin bump moves the machine to the new version. With `--cache-dir` it keeps the
// verified archive and its checksums.txt in that directory and installs from
// them when they still match, so a CI lane whose cache holds the pair installs
// while GitHub's release host is down; the line it prints says which source
// served it. `--print-archive` prints the release asset this machine would
// install and nothing else: the CI action keys its cache by it, so the key is
// exactly what is cached.

import { realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CliExitError } from "../src/errors/cli-exit-error.js";
import {
  DEFAULT_TEMPORAL_VERSION,
  type TarballInstall,
  downloadTemporalCli,
  temporalArchiveName,
} from "../src/local/temporal/download.js";

/** What the command line asks for. */
export type Invocation =
  | { mode: "install"; binDir: string; cacheDir: string | undefined }
  | { mode: "print-archive" }
  | { mode: "usage-error"; message: string };

export function parseArgs(argv: string[]): Invocation {
  let binDir = "";
  let cacheDir = "";
  let printArchive = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--bin-dir") binDir = argv[++i] ?? "";
    else if (argv[i] === "--cache-dir") cacheDir = argv[++i] ?? "";
    else if (argv[i] === "--print-archive") printArchive = true;
  }
  if (printArchive) return { mode: "print-archive" };
  if (binDir === "") return { mode: "usage-error", message: "--bin-dir is required" };
  return { mode: "install", binDir, cacheDir: cacheDir === "" ? undefined : cacheDir };
}

/** The line an install ends with: where the binary went, its version, and which source served it. */
export function describeInstall(binPath: string, version: string, result: TarballInstall): string {
  return `installed: ${binPath}  (Temporal CLI ${version}, checksum-verified, ${origin(result)})\n`;
}

function origin(result: TarballInstall): string {
  if (result.source === "cache") return "from the cache";
  switch (result.cache) {
    case "unused":
      return "downloaded";
    case "absent":
      return "downloaded; the cache had no copy";
    case "mismatch":
      return "downloaded; the cached copy did not match";
    default: {
      const unreachable: never = result.cache;
      return unreachable;
    }
  }
}

async function main(argv: string[]): Promise<void> {
  const invocation = parseArgs(argv);
  switch (invocation.mode) {
    case "print-archive":
      process.stdout.write(`${temporalArchiveName(DEFAULT_TEMPORAL_VERSION, process.platform, process.arch)}\n`);
      return;
    case "usage-error":
      process.stderr.write(`error: ${invocation.message}\n`);
      process.exit(1);
      return;
    case "install":
      await install(invocation.binDir, invocation.cacheDir);
      return;
    default: {
      const unreachable: never = invocation;
      throw new Error(`unhandled invocation ${JSON.stringify(unreachable)}`);
    }
  }
}

async function install(binDir: string, cacheDir: string | undefined): Promise<void> {
  const binPath = join(resolve(binDir), "temporal");
  try {
    const result = await downloadTemporalCli({
      version: DEFAULT_TEMPORAL_VERSION,
      binPath,
      cacheDir: cacheDir === undefined ? undefined : resolve(cacheDir),
    });
    process.stdout.write(describeInstall(binPath, DEFAULT_TEMPORAL_VERSION, result));
  } catch (err) {
    if (!(err instanceof CliExitError)) throw err;
    process.stderr.write(`error: ${err.message}\n`);
    for (const hint of err.hints ?? []) process.stderr.write(`  ${hint}\n`);
    process.exit(err.exitCode);
  }
}

// Node gives the entry module its real path, while argv[1] keeps the path as
// typed; comparing real paths keeps a run through a symlinked checkout from
// silently doing nothing.
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  await main(process.argv.slice(2));
}
