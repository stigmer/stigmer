#!/usr/bin/env node

/**
 * Waits until each named package at one version is installable from npm,
 * then exits 0; refuses with the registry-lag message once the budget is
 * spent. The release's own registry wait (publish-standalone.mjs's
 * `waitForRegistry` over `installGap`, step 4 of its header) as a command,
 * for a lane that installs a package another workflow published:
 * release.mcp-server.yaml, whose image installs @stigmer/mcp-server.
 *
 * "Installable" is what an install needs: npm's install document lists the
 * version and the tarball it names answers (`installGap`). The schedule is
 * the release wait's: one deadline, a poll from 10 s doubling to a 60 s cap.
 * The registry is npm's own for the @stigmer scope (`configuredRegistry`).
 *
 * The image lane runs after release.npm-libs has finished green, so on a
 * release the package is normally served at once and this returns on the
 * first read. It earns its place on a dispatch, and as the honest check that
 * the version the image installs is served, since npm has taken 22 minutes
 * to serve a version it accepted (stigmer#1367).
 *
 * Usage:
 *   node scripts/wait-for-npm.mjs @stigmer/mcp-server --version 3.41.0
 *   node scripts/wait-for-npm.mjs <name>... --version <X.Y.Z> [--budget-minutes <n>]
 */

import { parseArgs as parseNodeArgs } from "node:util";
import { pathToFileURL } from "node:url";

import {
  configuredRegistry,
  installGap,
  waitForRegistry,
  WAIT_BUDGET_MS,
} from "./publish-standalone.mjs";

const USAGE = "usage: wait-for-npm.mjs <name>... --version <X.Y.Z> [--budget-minutes <n>]";

/** The packages, the version and the budget; refuses anything but a release version. */
export function parseArgs(argv) {
  const { values, positionals } = parseNodeArgs({
    args: argv,
    allowPositionals: true,
    options: { version: { type: "string" }, "budget-minutes": { type: "string" } },
  });
  if (positionals.length === 0) throw new Error(`name at least one package; ${USAGE}`);
  const version = values.version ?? "";
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`--version must be a release version (X.Y.Z or X.Y.Z-rc.N), got '${version}'`);
  }
  let budgetMs = WAIT_BUDGET_MS;
  if (values["budget-minutes"] !== undefined) {
    const minutes = Number(values["budget-minutes"]);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      throw new Error(`--budget-minutes must be a positive number, got '${values["budget-minutes"]}'`);
    }
    budgetMs = minutes * 60_000;
  }
  return { names: positionals, version, budgetMs };
}

/**
 * Parses `argv` and waits. `options` reach `waitForRegistry` (the clock, the
 * sleep, the query, the log), so the command is tested without a registry.
 */
export async function main(argv, options = {}) {
  const { names, version, budgetMs } = parseArgs(argv);
  let { gapOf } = options;
  if (gapOf === undefined) {
    const registry = configuredRegistry();
    gapOf = (name, v) => installGap(name, v, { registry });
  }
  console.log(`\n=== Waiting until npm serves ${names.map((n) => `${n}@${version}`).join(", ")} ===`);
  await waitForRegistry(names, version, { budgetMs, ...options, gapOf });
}

// Only run when invoked directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`wait-for-npm: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
