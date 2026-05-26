/**
 * Git workspace source — clones a repository into the workspace.
 *
 * Key behaviors ported from Python:
 * - Idempotent: detects existing .git and skips re-clone
 * - GitHub token injection via HTTPS URL (x-access-token)
 * - Token is never logged; sanitized in error messages
 * - GITHUB_TOKEN reported in consumedKeys for env stripping
 * - Multi-entry mode: clones into target_subdir
 * - Credential store configuration for git push/writeback
 */

import { join } from "node:path";
import {
  SourceType,
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

const GITHUB_HOST = "github.com";

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

  const githubToken = envVars.GITHUB_TOKEN;
  const consumedKeys: string[] = [];
  let cloneUrl = url;

  if (githubToken && url.includes(GITHUB_HOST)) {
    cloneUrl = injectToken(url, githubToken);
    consumedKeys.push("GITHUB_TOKEN");
  }

  const branchArgs = branch ? ["-b", branch] : [];

  try {
    await backend.execute(
      `git clone ${branchArgs.map(a => `'${a}'`).join(" ")} '${cloneUrl}' '${cloneDir}'`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const sanitized = githubToken
      ? message.replaceAll(githubToken, "***")
      : message;
    throw new WorkspaceProvisionError(
      SourceType.GIT_REPO,
      `Git clone failed: ${sanitized}`,
      { cause: err instanceof Error ? err : undefined, transient: true },
    );
  }

  let metadata = await extractGitMetadata(cloneDir, url, backend, targetSubdir);

  if (configureCredentials && githubToken && url.includes(GITHUB_HOST)) {
    const configured = await configureGitCredentialStore(backend, cloneDir, url, githubToken);
    if (configured) {
      metadata = { ...metadata, gitCredentialsConfigured: true };
    }
  }

  await addGitExcludes(backend, targetSubdir);

  return {
    rootDir: cloneDir,
    sourceType: SourceType.GIT_REPO,
    consumedKeys,
    workspaceDescription:
      `Your workspace is a git clone of ${url}` +
      (metadata.branch ? ` (branch: ${metadata.branch})` : "") +
      `.\nBase commit: ${metadata.baseCommit}`,
    gitMetadata: metadata,
    entryName: "",
  };
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

  const githubToken = envVars.GITHUB_TOKEN;
  if (configureCredentials && githubToken && url.includes(GITHUB_HOST)) {
    const configured = await configureGitCredentialStore(backend, cloneDir, url, githubToken);
    if (configured) {
      metadata = { ...metadata, gitCredentialsConfigured: true };
    }
  }

  return {
    rootDir: cloneDir,
    sourceType: SourceType.GIT_REPO,
    consumedKeys: [],
    workspaceDescription:
      `Your workspace is a git clone of ${url}` +
      (metadata.branch ? ` (branch: ${metadata.branch})` : "") +
      ` (existing repo detected).\nBase commit: ${metadata.baseCommit}`,
    gitMetadata: metadata,
    entryName: "",
  };
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

async function addGitExcludes(backend: WorkspaceBackend, targetSubdir?: string): Promise<void> {
  const excludePath = targetSubdir
    ? join(targetSubdir, ".git/info/exclude")
    : ".git/info/exclude";

  try {
    const current = await backend.readFile(excludePath);
    if (!current.includes(".stigmer")) {
      await backend.writeFile(excludePath, current.trimEnd() + "\n.stigmer\n");
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
    await exec(`git remote set-url origin '${cleanUrl}'`);
  } catch (err) {
    console.warn(`[git] Failed to clean remote URL (non-fatal): ${err}`);
    return false;
  }

  try {
    await exec(`git config credential.helper 'store --file=${credFile}'`);
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

function injectToken(url: string, token: string): string {
  return url.replace("https://", `https://x-access-token:${token}@`);
}

function stripToken(url: string): string {
  return url.replace(/https:\/\/[^@]+@/, "https://");
}
