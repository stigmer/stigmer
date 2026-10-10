/**
 * Git workspace source — clones a repository into the workspace.
 *
 * Key behaviors ported from Python:
 * - Idempotent: detects existing .git and skips re-clone
 * - A repository's token (the run's repository values, matched to this
 *   entry by its name and URL) reaches only the clone's network commands,
 *   and only for a URL whose host is github.com itself (isGitHubHttpsUrl):
 *   it is handed to each such command through git's per-command
 *   configuration and stored nowhere (../git-credential.ts). The remote URL
 *   is always the clean one, and `.git` holds no token.
 * - Token is never logged; sanitized in error messages
 * - Reuse scrubs what earlier runners stored: a token in the origin URL, a
 *   repo-local `.git-credentials` file and the `store` helper naming it
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

/** The credential file earlier runners kept inside the clone; reuse deletes it. */
const LEGACY_CREDENTIAL_FILE = ".git-credentials";

export async function provisionGit(options: GitProvisionOptions): Promise<ProvisionResult> {
  const { url, branch, backend, targetSubdir, writeBack } = options;

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
    await cloneInPlace(backend, cloneDir, stripToken(url), branch, token);
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
 * clones and on every turn that reuses the clone: the native system prompt
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
  await scrubStoredCredentials(backend, cloneDir);
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
 * Removes every token an earlier runner stored in a clone: a token-bearing
 * origin URL is rewritten clean, the repo-local `.git-credentials` file is
 * deleted, and the repo-local `store` helper that named it is unset (only
 * that one; a helper the owner set is left alone). Each step is non-fatal:
 * a clone with nothing stored is the common case.
 */
async function scrubStoredCredentials(backend: WorkspaceBackend, cloneDir: string): Promise<void> {
  const exec = (cmd: string) => backend.execute(cmd, { cwd: cloneDir });
  try {
    const origin = (await exec("git remote get-url origin")).trim();
    const clean = stripToken(origin);
    if (clean !== origin) {
      await exec(`git remote set-url origin ${shellQuote(clean)}`);
    }
  } catch (err) {
    console.warn(`[git] Could not read or clean the origin remote (non-fatal): ${err instanceof Error ? err.message.split("\n")[0] : err}`);
  }
  const credFile = join(cloneDir, ".git", LEGACY_CREDENTIAL_FILE);
  try {
    if (await backend.exists(credFile)) {
      await exec(`rm -f ${shellQuote(credFile)}`);
    }
  } catch (err) {
    console.warn(`[git] Could not remove the stored credential file (non-fatal): ${err}`);
  }
  try {
    const helpers = (await exec("git config --local --get-all credential.helper").catch(() => ""))
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    if (helpers.some((helper) => helper.startsWith("store --file=") && helper.endsWith(LEGACY_CREDENTIAL_FILE))) {
      await exec(`git config --local --unset-all credential.helper ${shellQuote(`^store --file=.*${LEGACY_CREDENTIAL_FILE}$`)}`);
    }
  } catch (err) {
    console.warn(`[git] Could not unset the stored credential helper (non-fatal): ${err}`);
  }
}

/**
 * Clone a repository into a directory that may already be non-empty.
 *
 * `git clone` refuses to write into a non-empty target, but cloud workspace
 * mounts are not guaranteed empty — a freshly provisioned ext4 PersistentVolume
 * ships a `lost+found` directory at its root. We therefore reproduce clone
 * semantics in place: init the repo, add the (clean) origin remote, fetch
 * all branches, and check out the requested branch (or the remote's default
 * branch when none is requested). The result is identical to a clone — a
 * working tree on a tracking branch — but tolerant of pre-existing content.
 * The token reaches the two commands that talk to the network, and only them.
 */
async function cloneInPlace(
  backend: WorkspaceBackend,
  cloneDir: string,
  cloneUrl: string,
  branch: string | undefined,
  token: string,
): Promise<void> {
  await backend.execute(`git init -q ${shellQuote(cloneDir)}`);

  const exec = (cmd: string) => backend.execute(cmd, { cwd: cloneDir });
  await exec(`git remote add origin ${shellQuote(cloneUrl)}`);
  await runNetworkGit(backend, "git fetch --quiet origin", { cwd: cloneDir, remoteUrl: cloneUrl, token });

  const targetBranch = branch && branch.length > 0
    ? branch
    : await resolveDefaultBranch(backend, cloneDir, cloneUrl, token);

  // No target branch means the remote has no branches (empty repository).
  // Leave the initialized repo as-is, matching `git clone` of an empty repo.
  if (!targetBranch) return;

  await exec(`git checkout ${shellQuote(targetBranch)}`);
}

/**
 * Resolve the remote's default branch after a fetch. Returns an empty string
 * when the remote exposes no default (e.g. an empty repository), so the caller
 * can skip checkout gracefully.
 */
async function resolveDefaultBranch(
  backend: WorkspaceBackend,
  cloneDir: string,
  cloneUrl: string,
  token: string,
): Promise<string> {
  try {
    await runNetworkGit(backend, "git remote set-head origin --auto", { cwd: cloneDir, remoteUrl: cloneUrl, token });
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
 * - `.stigmer` — platform-managed namespace (skills, inputs, attachments)
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
