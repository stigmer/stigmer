// Thin wrappers over the `git` CLI (the S5 decision: shell out rather than add a
// git library). Used for skill push provenance (local repo detection) and for
// cloning a remote repo when pushing with --git-url.

import { execFileSync } from "node:child_process";

function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

/** Repo root (`git rev-parse --show-toplevel`), or undefined if not a repo. */
export function getGitRepoRoot(dir: string): string | undefined {
  try {
    return git(["rev-parse", "--show-toplevel"], dir);
  } catch {
    return undefined;
  }
}

/** URL of the `origin` remote, or undefined if none. */
export function getGitRemoteUrl(dir: string): string | undefined {
  try {
    const url = git(["remote", "get-url", "origin"], dir);
    return url === "" ? undefined : url;
  } catch {
    return undefined;
  }
}

/** Current HEAD commit SHA, or undefined on error. */
export function getGitCommit(dir: string): string | undefined {
  try {
    return git(["rev-parse", "HEAD"], dir);
  } catch {
    return undefined;
  }
}

/** Current branch name, or undefined when detached or on error. */
export function getGitBranchName(dir: string): string | undefined {
  try {
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], dir);
    return branch === "" || branch === "HEAD" ? undefined : branch;
  } catch {
    return undefined;
  }
}

/**
 * Clone `gitUrl` into `destDir`, checking out `gitRef` if given. Tries a shallow
 * `--branch` clone first (fast for tags/branches), falling back to a full clone
 * plus checkout when the ref is a commit SHA. Mirrors Go's cloneRepository.
 */
export function cloneRepository(gitUrl: string, gitRef: string, destDir: string): void {
  const args = ["clone", "--depth", "1"];
  if (gitRef !== "") args.push("--branch", gitRef);
  args.push(gitUrl, destDir);

  try {
    execFileSync("git", args, { stdio: ["ignore", "ignore", "pipe"] });
    return;
  } catch (err) {
    if (gitRef === "") {
      throw new Error(`failed to clone repository: ${(err as Error).message}`);
    }
  }

  // Fallback: full clone, then checkout the ref (handles commit SHAs).
  execFileSync("git", ["clone", gitUrl, destDir], { stdio: ["ignore", "ignore", "pipe"] });
  execFileSync("git", ["checkout", gitRef], { cwd: destDir, stdio: ["ignore", "ignore", "pipe"] });
}
