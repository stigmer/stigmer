#!/usr/bin/env node

/**
 * The one version a from-source build of this checkout carries: `0.0.0-dev.<short sha>`.
 * It is npm-valid and unique per commit, and it is a prerelease, so the CLI's
 * runtime acquirers refuse to download it (an image or a staged tree bakes
 * everything, so nothing needs to). The all-in-one staging stamps it into
 * the image, and the upgrade rehearsal's targets stamp it into the server
 * they build (`STIGMER_SERVER_VERSION`, which getServerInfo reports). The
 * rehearsal then expects exactly this string from the upgraded server.
 *
 * Run as a script it prints the version, so the Makefile reads the same rule
 * instead of restating it.
 */

import { execFileSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** This checkout's from-source version, from its HEAD commit. */
export function sourceBuildVersion() {
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  return `0.0.0-dev.${sha}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${sourceBuildVersion()}\n`);
}
