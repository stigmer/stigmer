/**
 * Git workspace source — clones a repository into the workspace.
 *
 * Key behaviors:
 * - Idempotent: detects existing .git and skips re-clone
 * - A repository's token (the run's repository values, matched to this
 *   entry by its name and URL), only for a URL whose host is github.com
 *   itself (isGitHubHttpsUrl), never reaches the clone: the runner fetches
 *   with it into its own repository (../runner-git.ts) and hands the clone
 *   a bundle of the fetched branches and tags, which the clone fetches as
 *   it would from origin (#2095). A clone without a token (a public
 *   repository, another host) fetches from origin itself. The remote URL
 *   is always the clean one, and `.git` holds no token.
 * - Token is never logged; sanitized in error messages
 * - Commit: a commit the resource names is checked out on the branch after
 *   the fetch, fetched by id first when no branch holds it; the clone then
 *   sits on the branch at that commit, so write-back still has a base
 *   branch to open its pull request against. A reused clone is left where
 *   the agent's work put it: the commit is where a conversation starts, not
 *   where each turn is reset to. A commit that is not 7 to 64 hex digits is
 *   refused before any git command runs (assertCommitId).
 * - Multi-entry mode: clones into target_subdir
 * - Every value interpolated into a git command is shell-quoted (shellQuote)
 */

import { join } from "node:path";
import {
  WorkspaceProvisionError,
  type ProvisionResult,
  type GitMetadata,
  type WorkspaceBackend,
} from "../types.js";
import { maskToken } from "../git-credential.js";
import { cloneHaves, fetchFromRunner, shellQuote, type CloneExec } from "../clone-handoff.js";
import { withRunnerRepository, type RunnerRepository } from "../runner-git.js";

export interface GitProvisionOptions {
  url: string;
  branch?: string;
  /** The commit to check out after the clone; empty or absent for the branch's tip. */
  commit?: string;
  backend: WorkspaceBackend;
  /** The repository's token from the run's values; absent for a public clone. */
  token?: string;
  isLocalMode: boolean;
  targetSubdir?: string;
  /** Whether write-back may push this clone (a cloud workspace). */
  writeBack?: boolean;
}

/** The one host the executing user's GitHub token is ever sent to. */
const GITHUB_HOST = "github.com";

/** A commit id as a resource names one: an abbreviated or full SHA-1 or SHA-256 object name. */
const COMMIT_ID = /^[0-9a-fA-F]{7,64}$/;

export async function provisionGit(options: GitProvisionOptions): Promise<ProvisionResult> {
  const { url, branch, commit, backend, targetSubdir, writeBack } = options;
  if (commit) assertCommitId(commit);

  const cloneDir = targetSubdir
    ? join(backend.rootDir, targetSubdir)
    : backend.rootDir;
  const token = options.token && isGitHubHttpsUrl(url) ? options.token : "";

  const gitExists = await backend.exists(
    targetSubdir ? join(targetSubdir, ".git") : ".git",
  );

  if (gitExists) {
    return reuseExistingRepo(cloneDir, url, backend, token, writeBack);
  }

  try {
    await cloneInPlace(backend, cloneDir, stripToken(url), { branch, commit }, token);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new WorkspaceProvisionError(
      "git_repo",
      `Git clone failed: ${maskToken(message, token)}`,
      { cause: err instanceof Error ? err : undefined, transient: true },
    );
  }

  const metadata = await extractGitMetadata(cloneDir, url, backend, writeBack === true && token !== "");

  await addGitExcludes(backend, targetSubdir);

  return {
    rootDir: cloneDir,
    sourceType: "git_repo",
    workspaceDescription: describeClone(url, metadata.branch),
    gitMetadata: metadata,
    entryName: "",
  };
}

/**
 * The model's description of a cloned workspace, the same on the turn that
 * clones and on every turn that reuses the clone: the Stigmer harness's system prompt
 * carries it and must not change from one message to the next. So it names
 * the repository and the branch, never the commit (write-back commits move
 * `HEAD` on every approved turn) and never whether the clone was reused. The
 * branch changes only when a branch really changes, and the text says so.
 */
function describeClone(url: string, branch: string): string {
  return `Your workspace is a git clone of ${url}` + (branch ? ` (branch: ${branch})` : "") + ".";
}

async function reuseExistingRepo(
  cloneDir: string,
  url: string,
  backend: WorkspaceBackend,
  token: string,
  writeBack: boolean | undefined,
): Promise<ProvisionResult> {
  const metadata = await extractGitMetadata(cloneDir, url, backend, writeBack === true && token !== "");

  return {
    rootDir: cloneDir,
    sourceType: "git_repo",
    workspaceDescription: describeClone(url, metadata.branch),
    gitMetadata: metadata,
    entryName: "",
  };
}

/**
 * Clone a repository into a directory that may already be non-empty.
 *
 * `git clone` refuses to write into a non-empty target, but cloud workspace
 * mounts are not guaranteed empty — a freshly provisioned ext4 PersistentVolume
 * ships a `lost+found` directory at its root. We therefore reproduce clone
 * semantics in place: init the repo, add the (clean) origin remote, fetch
 * all branches and tags, and check out the requested branch (or the
 * remote's default branch when none is requested); then, when a commit is
 * named, put the branch at that commit (see the module header). The result
 * is identical to a clone — a working tree on a tracking branch — but
 * tolerant of pre-existing content. With a token the fetches come from the
 * runner's repository as bundles; without one, from origin.
 */
async function cloneInPlace(
  backend: WorkspaceBackend,
  cloneDir: string,
  cloneUrl: string,
  target: CloneTarget,
  token: string,
): Promise<void> {
  await backend.execute(`git init -q ${shellQuote(cloneDir)}`);

  const exec: CloneExec = (cmd) => backend.execute(cmd, { cwd: cloneDir });
  await exec(`git remote add origin ${shellQuote(cloneUrl)}`);
  if (token === "") {
    await fetchFromOrigin(exec, target);
    return;
  }
  await withRunnerRepository(cloneDir, cloneUrl, token, (repository) => fetchThroughRunner(repository, exec, target));
}

interface CloneTarget {
  readonly branch: string | undefined;
  readonly commit: string | undefined;
}

/** A clone without a token: the clone's own git fetches from origin, as `git clone` would. */
async function fetchFromOrigin(exec: CloneExec, target: CloneTarget): Promise<void> {
  await exec("git fetch --quiet origin");

  const targetBranch = target.branch && target.branch.length > 0
    ? target.branch
    : await resolveDefaultBranch(exec);

  // No target branch means the remote has no branches (empty repository).
  // Leave the initialized repo as-is, matching `git clone` of an empty repo.
  if (!targetBranch) return;

  await exec(`git checkout ${shellQuote(targetBranch)}`);
  if (!target.commit) return;

  const commit = target.commit;
  if (!(await holdsCommit(exec, commit))) await exec(`git fetch --quiet origin ${shellQuote(commit)}`);
  await exec(`git reset --quiet --hard ${shellQuote(commit)}`);
}

/**
 * A clone with a token: the runner fetches every branch and tag into its
 * own repository and hands them over as one bundle, which the clone fetches
 * to `refs/remotes/origin/*` and `refs/tags/*` as a fetch from origin would;
 * `refs/remotes/origin/HEAD` names the default branch, as `remote set-head
 * --auto` would. A named commit no branch holds is fetched by the runner
 * and handed over the same way, leaving no ref in the clone (its fetch
 * writes `FETCH_HEAD` alone, as `git fetch origin <commit>` does). An empty
 * repository sends nothing and leaves the clone empty.
 */
async function fetchThroughRunner(repository: RunnerRepository, exec: CloneExec, target: CloneTarget): Promise<void> {
  await repository.fetch(["+refs/heads/*:refs/heads/*", "+refs/tags/*:refs/tags/*"], { prune: true });
  const defaultBranch = await repository.defaultBranch();
  await fetchFromRunner(repository, exec, {
    revisions: ["--branches", "--tags"],
    haves: [],
    refspecs: ["+refs/heads/*:refs/remotes/origin/*", "+refs/tags/*:refs/tags/*"],
  });
  if (defaultBranch) {
    await exec(`git symbolic-ref refs/remotes/origin/HEAD ${shellQuote(`refs/remotes/origin/${defaultBranch}`)}`);
  }

  const targetBranch = target.branch && target.branch.length > 0 ? target.branch : defaultBranch;
  if (!targetBranch) return;

  await exec(`git checkout ${shellQuote(targetBranch)}`);
  if (!target.commit) return;

  const commit = target.commit;
  if (!(await holdsCommit(exec, commit))) {
    await repository.fetch([`+${commit}:refs/stigmer/commit`]);
    await fetchFromRunner(repository, exec, {
      revisions: ["refs/stigmer/commit"],
      haves: await cloneHaves(exec),
      refspecs: ["refs/stigmer/commit"],
    });
  }
  await exec(`git reset --quiet --hard ${shellQuote(commit)}`);
}

/** Whether the clone holds `commit`. */
function holdsCommit(exec: CloneExec, commit: string): Promise<boolean> {
  return exec(`git cat-file -e ${shellQuote(`${commit}^{commit}`)}`).then(() => true, () => false);
}

/**
 * Refuses a commit that is not an object id: the value reaches `git fetch`,
 * `git cat-file` and `git reset` as an argument, and one that starts with
 * `-` (`--upload-pack=…`) would be read as an option. Hex digits alone can
 * never be. The commands carry no `--end-of-options` as a second guard: git
 * learned it in 2.24, and only the runner's own git has a floor (2.31,
 * ../git-credential.ts); a clone's git may be any, and an older one refuses
 * the marker as an unknown option. This check is the guard.
 */
function assertCommitId(commit: string): void {
  if (!COMMIT_ID.test(commit)) {
    throw new WorkspaceProvisionError(
      "git_repo",
      `The commit '${commit}' is not a commit id: name it by 7 to 64 hexadecimal digits.`,
    );
  }
}

/**
 * Resolve the remote's default branch after a fetch from origin. Returns an
 * empty string when the remote exposes no default (e.g. an empty
 * repository), so the caller can skip checkout gracefully.
 */
async function resolveDefaultBranch(exec: CloneExec): Promise<string> {
  try {
    await exec("git remote set-head origin --auto");
    const ref = (await exec("git symbolic-ref --short refs/remotes/origin/HEAD")).trim();
    return ref.replace(/^origin\//, "");
  } catch {
    return "";
  }
}

async function extractGitMetadata(
  cloneDir: string,
  url: string,
  backend: WorkspaceBackend,
  writeBackReady: boolean,
): Promise<GitMetadata> {
  let branchName = "";
  let headSha = "";

  try {
    branchName = (await backend.execute("git rev-parse --abbrev-ref HEAD", { cwd: cloneDir })).trim();
  } catch { /* non-fatal */ }

  try {
    headSha = (await backend.execute("git rev-parse HEAD", { cwd: cloneDir })).trim();
  } catch { /* non-fatal */ }

  return {
    repoUrl: stripToken(url),
    branch: branchName,
    baseCommit: headSha,
    writeBackReady,
  };
}

/**
 * Working-tree entries the agent should never see as untracked changes:
 * - `.stigmer` — platform-managed namespace (skills, uploads, inputs)
 * - `lost+found` — present at the root of a freshly provisioned ext4
 *   PersistentVolume, which is where single-entry sessions clone in place
 */
const GIT_EXCLUDE_ENTRIES = [".stigmer", "lost+found"];

async function addGitExcludes(backend: WorkspaceBackend, targetSubdir?: string): Promise<void> {
  const excludePath = targetSubdir
    ? join(targetSubdir, ".git/info/exclude")
    : ".git/info/exclude";

  try {
    const current = await backend.readFile(excludePath);
    const missing = GIT_EXCLUDE_ENTRIES.filter((entry) => !current.includes(entry));
    if (missing.length > 0) {
      await backend.writeFile(
        excludePath,
        current.trimEnd() + "\n" + missing.join("\n") + "\n",
      );
    }
  } catch {
    // .git/info/exclude might not exist — non-fatal
  }
}

/**
 * Whether `url` is an HTTPS URL whose host is exactly github.com, the only URL
 * the GitHub token may travel in. The host is read from the parsed URL: a
 * substring test would hand the token to any URL that merely mentions
 * github.com, as a longer host (github.com.example.net) or inside a path.
 */
function isGitHubHttpsUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && parsed.hostname === GITHUB_HOST;
}

/** `url` with any credentials it carries removed. */
function stripToken(url: string): string {
  return url.replace(/https:\/\/[^@/]+@/, "https://");
}
