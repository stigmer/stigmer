/**
 * Git workspace source — clones a repository into the workspace.
 *
 * Key behaviors ported from Python:
 * - Idempotent: detects existing .git and skips re-clone
 * - GitHub token injection via HTTPS URL (x-access-token)
 * - Token is never logged; sanitized in error messages
 * - GITHUB_TOKEN reported in consumedKeys for env stripping
 * - Multi-entry mode: clones into target_subdir
 *
 * Phase 2 scope: local backend only (direct git via child_process).
 * The FUSE+S3/Daytona --separate-git-dir pattern and credential
 * persistence are deferred to Phase 3.
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
}

const GITHUB_HOST = "github.com";

export async function provisionGit(options: GitProvisionOptions): Promise<ProvisionResult> {
  const { url, branch, backend, envVars, isLocalMode, targetSubdir } = options;

  const cloneDir = targetSubdir
    ? join(backend.rootDir, targetSubdir)
    : backend.rootDir;

  const gitExists = await backend.exists(
    targetSubdir ? join(targetSubdir, ".git") : ".git",
  );

  if (gitExists) {
    return reuseExistingRepo(cloneDir, url, backend, targetSubdir);
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

  const metadata = await extractGitMetadata(cloneDir, url, backend, targetSubdir);

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
  targetSubdir?: string,
): Promise<ProvisionResult> {
  const metadata = await extractGitMetadata(cloneDir, url, backend, targetSubdir);
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

function injectToken(url: string, token: string): string {
  return url.replace("https://", `https://x-access-token:${token}@`);
}

function stripToken(url: string): string {
  return url.replace(/https:\/\/[^@]+@/, "https://");
}
