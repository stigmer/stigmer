/**
 * Git workspace source — clones a repository into the workspace.
 *
 * Key behaviors ported from Python:
 * - Idempotent: detects existing .git and skips re-clone
 * - GitHub token injection via HTTPS URL (x-access-token), only for a URL whose
 *   host is github.com itself (isGitHubHttpsUrl)
 * - Token is never logged; sanitized in error messages
 * - GITHUB_TOKEN reported in consumedKeys whenever it serves the clone, on
 *   the cloning turn and on every reuse: the agent's shell receives it
 *   (shell-env.ts shellRunValues), because the clone already put it in the
 *   shell's reach (the remote URL locally, the credential store in cloud)
 * - Multi-entry mode: clones into target_subdir
 * - Credential store configuration for git push/writeback
 * - Every value interpolated into a git command is shell-quoted (shellQuote)
 */

import { join } from "node:path";
import {
  WorkspaceProvisionError,
  type ProvisionResult,
  type GitMetadata,
  type WorkspaceBackend,
} from "../types.js";

export interface GitProvisionOptions {
  url: string;
  branch?: string;
  backend: WorkspaceBackend;
  envVars: Record<string, string>;
  isLocalMode: boolean;
  targetSubdir?: string;
  configureCredentials?: boolean;
}

/** The one host the executing user's GitHub token is ever sent to. */
const GITHUB_HOST = "github.com";

/** The run value a GitHub clone authenticates with. */
export const GITHUB_TOKEN_KEY = "GITHUB_TOKEN";

export async function provisionGit(options: GitProvisionOptions): Promise<ProvisionResult> {
  const { url, branch, backend, envVars, isLocalMode, targetSubdir, configureCredentials } = options;

  const cloneDir = targetSubdir
    ? join(backend.rootDir, targetSubdir)
    : backend.rootDir;

  const gitExists = await backend.exists(
    targetSubdir ? join(targetSubdir, ".git") : ".git",
  );

  if (gitExists) {
    return reuseExistingRepo(cloneDir, url, backend, envVars, configureCredentials, targetSubdir);
  }

  const githubToken = envVars[GITHUB_TOKEN_KEY];
  const consumedKeys: string[] = [];
  let cloneUrl = url;

  if (githubToken && isGitHubHttpsUrl(url)) {
    cloneUrl = injectToken(url, githubToken);
    consumedKeys.push(GITHUB_TOKEN_KEY);
  }

  try {
    await cloneInPlace(backend, cloneDir, cloneUrl, branch);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const sanitized = githubToken
      ? message.replaceAll(githubToken, "***")
      : message;
    throw new WorkspaceProvisionError(
      "git_repo",
      `Git clone failed: ${sanitized}`,
      { cause: err instanceof Error ? err : undefined, transient: true },
    );
  }

  let metadata = await extractGitMetadata(cloneDir, url, backend, targetSubdir);

  if (configureCredentials && githubToken && isGitHubHttpsUrl(url)) {
    const configured = await configureGitCredentialStore(backend, cloneDir, url, githubToken);
    if (configured) {
      metadata = { ...metadata, gitCredentialsConfigured: true };
    }
  }

  await addGitExcludes(backend, targetSubdir);

  return {
    rootDir: cloneDir,
    sourceType: "git_repo",
    consumedKeys,
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
  envVars: Record<string, string>,
  configureCredentials?: boolean,
  targetSubdir?: string,
): Promise<ProvisionResult> {
  let metadata = await extractGitMetadata(cloneDir, url, backend, targetSubdir);

  // The token counts as consumed only where the clone holds it, as on the
  // cloning turn: the credential store configured here (cloud), or the
  // origin remote the clone wrote with this very token (local). A clone
  // made without a token, or a store that failed to configure, holds none.
  const githubToken = envVars[GITHUB_TOKEN_KEY];
  let tokenInClone = false;
  if (githubToken && isGitHubHttpsUrl(url)) {
    if (configureCredentials) {
      tokenInClone = await configureGitCredentialStore(backend, cloneDir, url, githubToken);
      if (tokenInClone) {
        metadata = { ...metadata, gitCredentialsConfigured: true };
      }
    } else {
      tokenInClone = await originCarries(backend, cloneDir, injectToken(url, githubToken));
    }
  }

  return {
    rootDir: cloneDir,
    sourceType: "git_repo",
    consumedKeys: tokenInClone ? [GITHUB_TOKEN_KEY] : [],
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
 * semantics in place: init the repo, add the (token-injected) origin remote,
 * fetch all branches, and check out the requested branch (or the remote's
 * default branch when none is requested). The result is identical to a clone —
 * a working tree on a tracking branch — but tolerant of pre-existing content.
 */
async function cloneInPlace(
  backend: WorkspaceBackend,
  cloneDir: string,
  cloneUrl: string,
  branch: string | undefined,
): Promise<void> {
  await backend.execute(`git init -q ${shellQuote(cloneDir)}`);

  const exec = (cmd: string) => backend.execute(cmd, { cwd: cloneDir });
  await exec(`git remote add origin ${shellQuote(cloneUrl)}`);
  await exec("git fetch --quiet origin");

  const targetBranch = branch && branch.length > 0
    ? branch
    : await resolveDefaultBranch(backend, cloneDir);

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
): Promise<string> {
  const exec = (cmd: string) => backend.execute(cmd, { cwd: cloneDir });
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
  targetSubdir?: string,
): Promise<GitMetadata> {
  const cwd = targetSubdir ?? undefined;
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
    gitCredentialsConfigured: false,
  };
}

/** Whether the clone's origin remote is exactly `remoteUrl`; a failed read is "no". */
async function originCarries(
  backend: WorkspaceBackend,
  cloneDir: string,
  remoteUrl: string,
): Promise<boolean> {
  try {
    return (await backend.execute("git remote get-url origin", { cwd: cloneDir })).trim() === remoteUrl;
  } catch {
    return false;
  }
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
 * Configure git credential store for push operations.
 *
 * Three-step process (each step is non-fatal):
 * 1. Clean the remote URL — remove any embedded token from the origin remote
 * 2. Set credential.helper to `store` with a repo-local credential file
 * 3. Write the credential entry to the file
 *
 * Using repo-local config (not --global) keeps credentials scoped to
 * the workspace and avoids polluting the host git config.
 */
async function configureGitCredentialStore(
  backend: WorkspaceBackend,
  cloneDir: string,
  url: string,
  token: string,
): Promise<boolean> {
  const exec = (cmd: string) => backend.execute(cmd, { cwd: cloneDir });
  const credFile = join(cloneDir, ".git", ".git-credentials");
  const cleanUrl = stripToken(url);

  try {
    await exec(`git remote set-url origin ${shellQuote(cleanUrl)}`);
  } catch (err) {
    console.warn(`[git] Failed to clean remote URL (non-fatal): ${err}`);
    return false;
  }

  try {
    await exec(`git config credential.helper ${shellQuote(`store --file=${credFile}`)}`);
  } catch (err) {
    console.warn(`[git] Failed to configure credential helper (non-fatal): ${err}`);
    return false;
  }

  const credEntry = `https://x-access-token:${token}@github.com\n`;
  try {
    await backend.writeFile(credFile, credEntry);
  } catch (err) {
    console.warn(`[git] Failed to write credential file (non-fatal): ${err}`);
    return false;
  }

  return true;
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

/** Sets the URL's credentials to the token (replacing any it carried). */
function injectToken(url: string, token: string): string {
  const parsed = new URL(url);
  parsed.username = "x-access-token";
  parsed.password = token;
  return parsed.toString();
}

/**
 * Quotes one value for a POSIX shell, so it reaches git as a single argument
 * whatever it contains: a quote inside a URL, a branch name or a path cannot
 * end the argument and start a command of its own.
 */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function stripToken(url: string): string {
  return url.replace(/https:\/\/[^@]+@/, "https://");
}
