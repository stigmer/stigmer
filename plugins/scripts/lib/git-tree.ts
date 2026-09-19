/**
 * A public repository at one ref, checked out into a directory, with the
 * commit it resolved to.
 *
 * The catalogue's tooling (the vendor audit, and the re-vendoring that
 * follows it) reads the vendors' marketplaces as trees on disk, the way the
 * CLI reads a marketplace after it has downloaded one. Two readers already
 * exist for that download and neither fits here: the CLI's zipball reader
 * is internal to `@stigmer/cli` (a deep import would tie the catalogue to a
 * client's private module), and the console's Trees API reader spends the
 * 60-per-hour unauthenticated budget the console needs. This tooling runs
 * by hand where `git` is installed, so it asks `git` for exactly one
 * commit's tree: a shallow fetch of the ref, then a checkout of what was
 * fetched. GitHub serves a shallow fetch of any reachable commit by SHA,
 * which is what lets `--ref owner/repo=<sha>` reproduce a past run.
 *
 * The commit is the pin. Every output that describes what was read carries
 * it, so a report and the vendoring that follows it name the same bytes.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

/** The ref `git` resolves when none is named: the repository's default branch. */
export const DEFAULT_REF = "HEAD";

export interface GitTreeSource {
  /** `owner/repo` on github.com. */
  readonly repo: string;
  /** A branch, a tag or a commit SHA; the default branch when absent. */
  readonly ref?: string;
}

export interface CheckedOutTree {
  readonly source: GitTreeSource;
  /** The directory that IS the repository root at `commit`. */
  readonly dir: string;
  /** The full SHA the ref resolved to. */
  readonly commit: string;
}

/** The clone URL of a public repository, over HTTPS so no key is involved. */
export function repositoryUrl(repo: string): string {
  return `https://github.com/${repo}.git`;
}

/**
 * Check `source` out into `dir` (created if missing, expected empty) and
 * report the commit. Throws with `git`'s own words when the repository or
 * the ref does not exist; there is no partial tree to read after a failure.
 */
export function checkoutTree(source: GitTreeSource, dir: string): CheckedOutTree {
  mkdirSync(dir, { recursive: true });
  const git = (...args: readonly string[]): string =>
    execFileSync("git", [...args], { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

  git("init", "--quiet");
  git("remote", "add", "origin", repositoryUrl(source.repo));
  git("fetch", "--quiet", "--depth", "1", "origin", source.ref ?? DEFAULT_REF);
  git("checkout", "--quiet", "FETCH_HEAD");
  const commit = git("rev-parse", "HEAD");
  return { source, dir, commit };
}
