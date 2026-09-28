// install-temporal-cli writes the Temporal CLI that `stigmer up` runs into a
// directory of the caller's choosing, for the places that need `temporal` on
// PATH without going through `stigmer up`: a developer machine running the
// execution suites, and the CI lanes that run them. Run by
// `make install-temporal-cli`, which writes ~/bin/temporal.
//
// It calls the product's own downloader, so the version is the pin in
// `src/local/temporal/download.ts`, the archive is verified against the
// release's checksums.txt, and a transient network failure is retried, exactly
// as for a user's first `stigmer up` and the all-in-one image. The suites then
// run against the Temporal users run, not whatever an installer calls latest.
//
// It always downloads, and never trusts a binary already in place (the
// downloader's `isTemporalInstalled` checks only that the file exists), so a
// rerun after a pin bump moves the machine to the new version.

import { join, resolve } from "node:path";
import { CliExitError } from "../src/errors/cli-exit-error.js";
import { DEFAULT_TEMPORAL_VERSION, downloadTemporalCli } from "../src/local/temporal/download.js";

async function main(argv: string[]): Promise<void> {
  const binDir = parseArgs(argv);
  if (binDir === "") {
    process.stderr.write("error: --bin-dir is required\n");
    process.exit(1);
  }
  const binPath = join(resolve(binDir), "temporal");
  try {
    await downloadTemporalCli({ version: DEFAULT_TEMPORAL_VERSION, binPath });
  } catch (err) {
    if (!(err instanceof CliExitError)) throw err;
    process.stderr.write(`error: ${err.message}\n`);
    for (const hint of err.hints ?? []) process.stderr.write(`  ${hint}\n`);
    process.exit(err.exitCode);
  }
  process.stdout.write(`installed: ${binPath}  (Temporal CLI ${DEFAULT_TEMPORAL_VERSION}, checksum-verified)\n`);
}

function parseArgs(argv: string[]): string {
  let binDir = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--bin-dir") binDir = argv[++i] ?? "";
  }
  return binDir;
}

await main(process.argv.slice(2));
