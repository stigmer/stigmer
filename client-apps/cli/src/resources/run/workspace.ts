// Workspace flag parsing for agent execution.
//
// Ports the Go CLI's run_workspace.go: turns repeatable `--workspace` values
// (plus `--branch`/`--commit`) into WorkspaceEntry protos. A workspace is either
// an HTTPS git repo (branch/commit allowed) or a local directory (branch/commit
// rejected). SSH git URLs are rejected with HTTPS guidance, and `--branch`/
// `--commit` only apply to a single git workspace.

import { statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, resolve } from "node:path";
import { create } from "@bufbuild/protobuf";
import {
  GitRepoSourceSchema,
  LocalPathSourceSchema,
  type WorkspaceEntry,
  WorkspaceEntrySchema,
  type WorkspaceSource,
  WorkspaceSourceSchema,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import { UsageError } from "../../errors/index.js";

/**
 * Convert `--workspace`/`--branch`/`--commit` flags into WorkspaceEntry protos.
 * Returns an empty list when no workspace is requested. Mirrors Go's
 * parseWorkspaceEntries, including the single-git-workspace rule for
 * branch/commit and duplicate-name detection.
 */
export function parseWorkspaceEntries(
  workspaces: readonly string[],
  branch: string,
  commit: string,
): WorkspaceEntry[] {
  if (workspaces.length === 0) {
    if (branch !== "" || commit !== "") {
      throw new UsageError("--branch and --commit require --workspace");
    }
    return [];
  }

  if (workspaces.length > 1 && (branch !== "" || commit !== "")) {
    throw new UsageError("--branch and --commit are only valid with a single git workspace");
  }

  const entries: WorkspaceEntry[] = [];
  const seenNames = new Map<string, string>(); // derived name -> original value
  for (const ws of workspaces) {
    const source = parseWorkspaceSource(ws, branch, commit);
    const name = deriveEntryName(ws);
    const prev = seenNames.get(name);
    if (prev !== undefined) {
      throw new UsageError(
        `duplicate workspace name "${name}" derived from both "${prev}" and "${ws}"; ` +
          "use distinct directory names or repository URLs",
      );
    }
    seenNames.set(name, ws);
    entries.push(create(WorkspaceEntrySchema, { name, source }));
  }
  return entries;
}

/**
 * The absolute paths of any local (non-git) workspace roots. Attachment
 * processing uses these to decide whether a file is workspace-relative (no
 * upload) versus an upload. Mirrors Go's localWorkspaceRoots.
 */
export function localWorkspaceRoots(entries: readonly WorkspaceEntry[]): string[] {
  const roots: string[] = [];
  for (const entry of entries) {
    if (entry.source?.source.case === "localPath") {
      roots.push(entry.source.source.value.path);
    }
  }
  return roots;
}

/** The derived display names of the workspace entries, for the session header. */
export function workspaceNames(entries: readonly WorkspaceEntry[]): string[] {
  return entries.map((entry) => entry.name);
}

// Mirrors Go's parseWorkspaceSource: variant selection (git vs local) plus the
// branch/commit applicability rules and SSH rejection.
function parseWorkspaceSource(workspace: string, branch: string, commit: string): WorkspaceSource {
  if (isSshGitUrl(workspace)) {
    throw new UsageError(
      `SSH git URLs are not supported: ${workspace}\n\n` +
        "Use HTTPS instead: https://github.com/org/repo",
    );
  }

  if (isGitUrl(workspace)) {
    return create(WorkspaceSourceSchema, {
      source: { case: "gitRepo", value: create(GitRepoSourceSchema, { url: workspace, branch, commit }) },
    });
  }

  if (branch !== "" || commit !== "") {
    throw new UsageError("--branch and --commit are only valid with git workspace URLs (https://...)");
  }
  return parseLocalWorkspace(workspace);
}

// Resolve a local path, verify it is an existing directory, and wrap it as a
// LocalPathSource. Mirrors Go's parseLocalWorkspace.
function parseLocalWorkspace(path: string): WorkspaceSource {
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

  return create(WorkspaceSourceSchema, {
    source: { case: "localPath", value: create(LocalPathSourceSchema, { path: resolved }) },
  });
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
