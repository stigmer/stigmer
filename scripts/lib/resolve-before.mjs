#!/usr/bin/env node
/**
 * The one rule for how far back a gate's fresh npm resolution looks, shared
 * by scripts/verify-consumer-install.mjs (`--resolve-before <hours>`) and the
 * clean-room typecheck in .github/workflows/ci.ts-workspace.yaml, which calls
 * this file to print the cutoff.
 *
 * A fresh resolution (no lockfile) proves what a consumer installs from the
 * manifest's ranges, so it must stay live. But the registry serves a version's
 * metadata a few minutes before its tarball: a resolution that picks a version
 * published moments earlier can fail with E404 on the tarball, turning a gate
 * red, or ejecting a merge-queue entry, for a change that broke nothing
 * (stigmer/stigmer#1669: @aws-sdk/token-providers and baseline-browser-mapping
 * on 2026-10-01, each found on `latest` minutes later). npm's `--before <date>`
 * resolves only versions published by that date, so a margin of an hour skips
 * that window: the tree is the one a consumer installing an hour ago got,
 * which lags today's consumers by at most that hour's publishes.
 *
 * A release never passes it. publish-standalone.mjs runs the consumer check
 * over the @stigmer/* versions that very release published minutes earlier,
 * and a cutoff would refuse them.
 *
 * The trade-off: a manifest or override that pins a version published less
 * than an hour ago (a security update Dependabot opens at once, for one) fails
 * the gate with ETARGET until the hour has passed. Rerun the lane then; the
 * pin is not wrong, it is newer than the cutoff.
 *
 * Usage as a command: `node scripts/lib/resolve-before.mjs <hours>` prints the
 * `--before` value (an ISO timestamp) for that many hours before now.
 */

import { pathToFileURL } from "node:url";

/**
 * The `--before` value for a margin of `hours` before `now`: an ISO timestamp.
 * The margin must be a positive, finite number of hours.
 */
export function resolveBefore(hours, now = new Date()) {
  const margin = Number(hours);
  if (!Number.isFinite(margin) || margin <= 0) {
    throw new Error(`resolve-before: the margin must be a positive number of hours, not ${JSON.stringify(hours)}`);
  }
  return new Date(now.getTime() - margin * 3_600_000).toISOString();
}

/** The npm arguments a resolution adds for the margin: none when no margin is given. */
export function resolveBeforeArgs(hours, now = new Date()) {
  return hours === undefined ? [] : [`--before=${resolveBefore(hours, now)}`];
}

/**
 * The npm arguments a command line asks for: `--resolve-before <hours>` or
 * `--resolve-before=<hours>` gives the cutoff, its absence gives none, and the
 * flag with no value is refused rather than read as absent (which would
 * resolve live, the very thing the flag was given to avoid).
 */
export function resolveBeforeFromArgv(argv, now = new Date()) {
  const index = argv.findIndex((arg) => arg === "--resolve-before" || arg.startsWith("--resolve-before="));
  if (index === -1) return [];
  const flag = argv[index];
  const value = flag.includes("=") ? flag.slice("--resolve-before=".length) : argv[index + 1];
  if (value === undefined || value === "" || value.startsWith("--")) {
    throw new Error("resolve-before: --resolve-before needs a number of hours");
  }
  return resolveBeforeArgs(value, now);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(resolveBefore(process.argv[2]));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
