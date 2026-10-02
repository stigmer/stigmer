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
 * The hash is the first 7 characters of HEAD's full id, cut here rather than
 * by git. Git's `--short` sizes the abbreviation from how many objects the
 * repository holds, and even `--short=7` lengthens it when another object
 * shares the prefix, so the same HEAD could read 7 characters early in a run
 * and 8 after a step had fetched objects (the rehearsal fetches the release
 * tag between its two reads, the build's stamp and the check, and refused its
 * own build when they differed: stigmer#1748). Cut from the full id, the
 * version depends on HEAD alone.
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
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim().slice(0, 7);
  return `0.0.0-dev.${sha}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${sourceBuildVersion()}\n`);
}
