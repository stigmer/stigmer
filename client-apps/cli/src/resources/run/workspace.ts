// Workspace flag parsing for runs.
//
// Ports the Go CLI's run_workspace.go: turns repeatable `--workspace` values
// (plus `--branch`/`--commit`) into the conversation's resources. A workspace is
// either an HTTPS git repository (branch/commit allowed) or a local directory
// (branch/commit rejected). SSH git URLs are rejected with HTTPS guidance, and `--branch`/
// `--commit` only apply to a single git workspace.

import { statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";
import { create } from "@bufbuild/protobuf";
import {
  GitRepositoryResourceSchema,
  LocalPathResourceSchema,
  type SessionResource,
  SessionResourceSchema,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";
import { UsageError } from "../../errors/index.js";

/**
 * Convert `--workspace`/`--branch`/`--commit` flags into the conversation's
 * repository and folder resources. Returns an empty list when no workspace is
 * requested. Mirrors Go's parseWorkspaceEntries, including the
 * single-git-workspace rule for branch/commit and duplicate-name detection.
 */
export function parseWorkspaceResources(
  workspaces: readonly string[],
  branch: string,
  commit: string,
): SessionResource[] {
  if (workspaces.length === 0) {
    if (branch !== "" || commit !== "") {
      throw new UsageError("--branch and --commit require --workspace");
    }
    return [];
  }

  if (workspaces.length > 1 && (branch !== "" || commit !== "")) {
    throw new UsageError("--branch and --commit are only valid with a single git workspace");
  }

  const entries: SessionResource[] = [];
  const seenNames = new Map<string, string>(); // derived name -> original value
  for (const ws of workspaces) {
    const resource = parseWorkspaceSource(ws, branch, commit);
    const name = deriveEntryName(ws);
    const prev = seenNames.get(name);
    if (prev !== undefined) {
      throw new UsageError(
        `duplicate workspace name "${name}" derived from both "${prev}" and "${ws}"; ` +
          "use distinct directory names or repository URLs",
      );
    }
    seenNames.set(name, ws);
    entries.push(create(SessionResourceSchema, { name, resource }));
  }
  return entries;
}

/**
 * The absolute paths of any local (non-git) workspace roots. Attachment
 * planning uses these to decide whether a file is workspace-relative (no
 * upload) versus an upload. Mirrors Go's localWorkspaceRoots.
 */
export function localWorkspaceRoots(resources: readonly SessionResource[]): string[] {
  const roots: string[] = [];
  for (const entry of resources) {
    if (entry.resource.case === "localPath") {
      roots.push(entry.resource.value.path);
    }
  }
  return roots;
}

// Mirrors Go's parseWorkspaceSource: the resource arm (git vs local) plus the
// branch/commit applicability rules and SSH rejection.
function parseWorkspaceSource(workspace: string, branch: string, commit: string): SessionResource["resource"] {
  if (isSshGitUrl(workspace)) {
    throw new UsageError(
      `SSH git URLs are not supported: ${workspace}\n\n` +
        "Use HTTPS instead: https://github.com/org/repo",
    );
  }

  if (isGitUrl(workspace)) {
    return {
      case: "gitRepository",
      value: create(GitRepositoryResourceSchema, { url: workspace, branch, commit }),
    };
  }

  if (branch !== "" || commit !== "") {
    throw new UsageError("--branch and --commit are only valid with git workspace URLs (https://...)");
  }
  return parseLocalWorkspace(workspace);
}

// Resolve a local path, verify it is an existing directory, and wrap it as a
// local path resource. Mirrors Go's parseLocalWorkspace.
function parseLocalWorkspace(path: string): SessionResource["resource"] {
  const resolved = resolveLocalPath(path);
  let isDir: boolean;
  try {
    isDir = statSync(resolved).isDirectory();
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") throw new UsageError(`workspace path does not exist: ${resolved}`);
    throw new UsageError(`cannot access workspace path ${resolved}: ${e.message}`);
  }
  if (!isDir) throw new UsageError(`workspace path is not a directory: ${resolved}`);

  return { case: "localPath", value: create(LocalPathResourceSchema, { path: resolved }) };
}

// A short identity for the entry: the repo name for git URLs, the directory
// basename for local paths. Mirrors Go's deriveEntryName.
function deriveEntryName(workspace: string): string {
  if (isGitUrl(workspace)) return deriveGitRepoName(workspace);
  return deriveLocalDirName(workspace);
}

// Last non-empty URL path segment, sans ".git". Mirrors Go's deriveGitRepoName.
function deriveGitRepoName(rawUrl: string): string {
  let path: string;
  try {
    path = new URL(rawUrl).pathname;
  } catch {
    throw new UsageError(`cannot parse git URL for name derivation: ${rawUrl}`);
  }
  path = path.replace(/\/+$/, "").replace(/\.git$/, "");
  const segments = path.split("/");
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i] !== "") return segments[i];
  }
  throw new UsageError(`cannot derive workspace name from URL: ${rawUrl}`);
}

// Directory basename of the resolved absolute path. Mirrors Go's
// deriveLocalDirName — "." resolves to the CWD basename, not ".".
function deriveLocalDirName(path: string): string {
  const resolved = resolveLocalPath(path);
  const name = basename(resolved);
  if (name === "." || name === "/" || name === "") {
    throw new UsageError(`cannot derive workspace name from path: ${path}`);
  }
  return name;
}

// Expand a leading "~/" and make the path absolute. Mirrors Go's resolveLocalPath.
function resolveLocalPath(path: string): string {
  let p = path;
  if (p.startsWith("~/")) p = resolve(homedir(), p.slice(2));
  return isAbsolute(p) ? p : resolve(p);
}

function isGitUrl(s: string): boolean {
  return s.startsWith("https://") || s.startsWith("http://");
}

function isSshGitUrl(s: string): boolean {
  return s.startsWith("git@");
}
