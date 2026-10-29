/**
 * Git workspace source — clones a repository into the workspace.
 *
 * Key behaviors:
 * - Idempotent: detects existing .git and skips re-clone
 * - A repository's token (the run's repository values, matched to this
 *   entry by its name and URL) reaches only the clone's network commands,
 *   and only for a URL whose host is github.com itself (isGitHubHttpsUrl):
 *   it is handed to each such command through git's per-command
 *   configuration and stored nowhere (../git-credential.ts). The remote URL
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
import { maskToken, runNetworkGit } from "../git-credential.js";

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
 * all branches, and check out the requested branch (or the remote's default
 * branch when none is requested); then, when a commit is named, put the
 * branch at that commit (see the module header). The result is identical
 * to a clone — a working tree on a tracking branch — but tolerant of
 * pre-existing content. The token reaches the commands that talk to the
 * network, and only them.
 */
async function cloneInPlace(
  backend: WorkspaceBackend,
  cloneDir: string,
  cloneUrl: string,
  target: { readonly branch: string | undefined; readonly commit: string | undefined },
  token: string,
): Promise<void> {
  await backend.execute(`git init -q ${shellQuote(cloneDir)}`);

  const exec = (cmd: string) => backend.execute(cmd, { cwd: cloneDir });
  const network = (cmd: string) => runNetworkGit(backend, cmd, { cwd: cloneDir, remoteUrl: cloneUrl, token });
  await exec(`git remote add origin ${shellQuote(cloneUrl)}`);
  await network("git fetch --quiet origin");

  const targetBranch = target.branch && target.branch.length > 0
    ? target.branch
    : await resolveDefaultBranch(backend, cloneDir, network);

  // No target branch means the remote has no branches (empty repository).
  // Leave the initialized repo as-is, matching `git clone` of an empty repo.
  if (!targetBranch) return;

  await exec(`git checkout ${shellQuote(targetBranch)}`);
  if (!target.commit) return;

  const commit = target.commit;
  const present = await exec(`git cat-file -e ${shellQuote(`${commit}^{commit}`)}`).then(() => true, () => false);
  if (!present) await network(`git fetch --quiet origin ${shellQuote(commit)}`);
  await exec(`git reset --quiet --hard ${shellQuote(commit)}`);
}

/**
 * Refuses a commit that is not an object id: the value reaches `git fetch`,
 * `git cat-file` and `git reset` as an argument, and one that starts with
 * `-` (`--upload-pack=…`) would be read as an option. Hex digits alone can
 * never be. The commands carry no `--end-of-options` as a second guard: git
 * learned it in 2.24, and only a clone that needs a token has a git floor
 * (2.31, ../git-credential.ts); a public clone runs on any git, and an older
 * one refuses the marker as an unknown option. This check is the guard.
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
 * Resolve the remote's default branch after a fetch. Returns an empty string
 * when the remote exposes no default (e.g. an empty repository), so the caller
 * can skip checkout gracefully.
 */
async function resolveDefaultBranch(
  backend: WorkspaceBackend,
  cloneDir: string,
  network: (cmd: string) => Promise<string>,
): Promise<string> {
  try {
    await network("git remote set-head origin --auto");
    const ref = (await backend.execute("git symbolic-ref --short refs/remotes/origin/HEAD", { cwd: cloneDir })).trim();
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

/**
 * Quotes one value for a POSIX shell, so it reaches git as a single argument
 * whatever it contains: a quote inside a URL, a branch name or a path cannot
 * end the argument and start a command of its own.
 */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** `url` with any credentials it carries removed. */
function stripToken(url: string): string {
  return url.replace(/https:\/\/[^@/]+@/, "https://");
}
