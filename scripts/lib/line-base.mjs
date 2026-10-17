#!/usr/bin/env node

/**
 * The next version on the release line, read from the checkout's stable
 * `vX.Y.Z` tags: the one rule the dev lanes (release.dev.yaml's
 * determine-version and scripts/publish-dev-local.sh) take their base from
 * and `make release` takes its new tag from, so the three cannot drift apart.
 *
 * Once a stable tag exists, the next version bumps the newest one: the patch
 * by default (a dev build targets the next unreleased patch, so it sorts
 * below the release it precedes), or the minor or major `make release
 * bump=` asks for. With no stable tag the line has not released yet and
 * starts at 0.1.0, whatever the bump: the first release is v0.1.0 and every
 * dev build before it is a 0.1.0 prerelease. The bump is still checked, so
 * a typo is refused on a fresh line as on an established one.
 *
 * Only `vX.Y.Z` counts. A prerelease tag (`v0.1.0-rc.1`) is not a release
 * the line has made, and tags under a path (`sdk/go/v0.1.0`) are the Go
 * module's twins of a release tag, not releases of their own. Tags are
 * ordered by number, so v3.10.0 is newer than v3.9.9.
 *
 * Refusing a version that already exists as a tag stays with each caller,
 * where the message names that caller's way to pass a higher one.
 *
 * Run as a script it prints the version, or with --latest the newest stable
 * tag (an empty line when there is none):
 *   node scripts/lib/line-base.mjs [--bump=patch|minor|major]
 *   node scripts/lib/line-base.mjs --latest
 */

import { execFileSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

/** Where a line with no stable release starts. */
export const LINE_START = "0.1.0";

/** The bumps a next version can take. */
export const BUMPS = Object.freeze(["patch", "minor", "major"]);

const STABLE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

/** The newest stable `vX.Y.Z` among `tags`, by number, or undefined when there is none. */
export function newestStableTag(tags) {
  let newest;
  let newestParts;
  for (const tag of tags) {
    const match = STABLE_TAG.exec(tag);
    if (match === null) continue;
    const parts = match.slice(1, 4).map(Number);
    if (newestParts === undefined || compareParts(parts, newestParts) > 0) {
      newest = tag;
      newestParts = parts;
    }
  }
  return newest;
}

function compareParts(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * The next `X.Y.Z` on the line given its tags and a bump: the bumped newest
 * stable tag, or LINE_START when there is none. Pure; throws on a bump
 * outside BUMPS.
 */
export function nextLineVersion({ tags, bump = "patch" }) {
  if (!BUMPS.includes(bump)) throw new Error(`invalid bump '${bump}' (use ${BUMPS.join("|")})`);
  const latest = newestStableTag(tags);
  if (latest === undefined) return LINE_START;
  const [major, minor, patch] = STABLE_TAG.exec(latest).slice(1, 4).map(Number);
  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    default:
      return `${major}.${minor}.${patch + 1}`;
  }
}

/** The `v*` tags a checkout holds. */
export function releaseTags(cwd = repoRoot) {
  return execFileSync("git", ["tag", "-l", "v*"], { cwd, encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: { bump: { type: "string" }, latest: { type: "boolean" } } });
    const tags = releaseTags();
    const printed = values.latest ? (newestStableTag(tags) ?? "") : nextLineVersion({ tags, bump: values.bump ?? "patch" });
    process.stdout.write(`${printed}\n`);
  } catch (error) {
    process.stderr.write(`line-base: ${error.message}\n`);
    process.exit(1);
  }
}
