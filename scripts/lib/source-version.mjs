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
 * The hash is asked for at an explicit length, 7. With none, git sizes the
 * abbreviation from how many objects the repository holds, so the same HEAD
 * can read 7 characters early in a run and 8 after a step has written
 * objects; the rehearsal reads it twice (the build's stamp, then the check)
 * and refused its own build when the two differed (stigmer#1748). With a
 * length given, git goes past it only for a real ambiguity.
 *
 * Run as a script it prints the version, so the Makefile reads the same rule
 * instead of restating it.
 */

import { execFileSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** A checkout's from-source version, from its HEAD commit: this checkout's unless `cwd` names another. */
export function sourceBuildVersion(cwd = repoRoot) {
  const sha = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd, encoding: "utf8" }).trim();
  return `0.0.0-dev.${sha}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${sourceBuildVersion()}\n`);
}
