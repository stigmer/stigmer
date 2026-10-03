#!/usr/bin/env node

/**
 * The npm version of a dev build: `<base>-dev.<stamp>.g<12-char sha>`, the
 * one rule both dev lanes stamp (release.dev.yaml's determine-version and
 * scripts/publish-dev-local.sh), so they cannot drift apart.
 *
 * The `.g<sha>` names the commit the build was made from (the `g` as in
 * `git describe`, so the identifier stays alphanumeric, which semver requires
 * of one that starts with a digit). A consumer that pins a dev build can then
 * check that exact commit out and ask where it sits, with no lookup: the cloud
 * composition builds the runner and console its gate runs from it, and
 * refuses a commit that is not on `main`. npm's `gitHead` cannot stand in for
 * this; it records whatever HEAD the publishing checkout had, which for a
 * local publish need not be the code that was packed.
 *
 * A tree with any uncommitted or untracked file gets no `.g<sha>`: its build
 * is not that commit's code, so it is published unattributed, and a consumer
 * that requires the commit refuses it.
 *
 * The hash is the first 12 characters of HEAD's full id, cut here rather than
 * by git, whose `--short` length depends on the repository's object count
 * (stigmer#1748). Twelve rather than source-version.mjs's seven because a
 * consumer resolves this prefix back to a commit, and a short prefix grows
 * ambiguous as the repository grows.
 *
 * Run as a script it prints the version:
 *   node scripts/lib/dev-version.mjs --base 3.41.1 --stamp 20261003120000
 */

import { execFileSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** Characters of the commit id a dev version carries. */
export const DEV_SHA_LENGTH = 12;

const BASE = /^\d+\.\d+\.\d+$/;
const STAMP = /^\d{14}$/;
const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * The dev npm version for a base release, a UTC stamp (`YYYYMMDDHHMMSS`) and
 * the checkout's state. Pure; throws on a malformed input rather than
 * publishing a version no consumer can parse.
 */
export function devNpmVersion({ base, stamp, sha, clean }) {
  if (!BASE.test(base)) throw new Error(`base must be X.Y.Z, got '${base}'`);
  if (!STAMP.test(stamp)) throw new Error(`stamp must be 14 digits (YYYYMMDDHHMMSS), got '${stamp}'`);
  if (!clean) return `${base}-dev.${stamp}`;
  if (!FULL_SHA.test(sha)) throw new Error(`sha must be a full 40-character commit id, got '${sha}'`);
  return `${base}-dev.${stamp}.g${sha.slice(0, DEV_SHA_LENGTH)}`;
}

/** A checkout's HEAD id and whether its tree holds nothing uncommitted or untracked. */
export function checkoutState(cwd = repoRoot) {
  const run = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" });
  return {
    sha: run("rev-parse", "HEAD").trim(),
    clean: run("status", "--porcelain").trim() === "",
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ options: { base: { type: "string" }, stamp: { type: "string" } } });
  try {
    process.stdout.write(`${devNpmVersion({ base: values.base ?? "", stamp: values.stamp ?? "", ...checkoutState() })}\n`);
  } catch (error) {
    process.stderr.write(`dev-version: ${error.message}\n`);
    process.exit(1);
  }
}
