"use client";

import { useCallback } from "react";
import type { WorkspaceFileEntry, WorkspaceFileLister } from "../workspace/WorkspaceFileLister.js";
import type { WorkspaceEntry } from "../workspace/useWorkspaceEntries.js";
import { parseGitUrl } from "./parseGitUrl.js";

const GITHUB_TREES_API = "https://api.github.com/repos";

interface GitHubTreeResponse {
  readonly sha: string;
  readonly url: string;
  readonly truncated: boolean;
  readonly tree: ReadonlyArray<{
    readonly path: string;
    readonly mode: string;
    readonly type: "blob" | "tree" | "commit";
    readonly sha: string;
    readonly size?: number;
    readonly url: string;
  }>;
}

/**
 * Advisory entry appended to the listing when the GitHub API indicates that the
 * tree was truncated (repository exceeds the API's entry limit). Flagged with
 * `notice: true` so generic consumers treat it as a "results incomplete" banner
 * rather than an openable file (see `workspaceListingCache`) — never a tree leaf,
 * never a search hit.
 */
const TRUNCATION_MARKER: WorkspaceFileEntry = {
  path: "... (tree truncated by GitHub — repository has too many files)",
  isDirectory: false,
  notice: true,
};

/**
 * Creates a {@link WorkspaceFileLister} backed by the GitHub Trees API.
 *
 * Uses the existing client-side OAuth token (same one that powers
 * `GitHubRepoPicker`) to call `GET /repos/{owner}/{repo}/git/trees/{ref}?recursive=1`,
 * where the ref is the entry's `readRef` (write-back commit) or `gitBranch`.
 *
 * Returns `null` for:
 * - Non-git workspace entries
 * - Missing or empty token
 * - Non-GitHub git URLs
 * - Failed API responses (graceful degradation)
 *
 * @example
 * ```tsx
 * const gitHubConnection = useGitHubConnection(org);
 * const fileLister = useGitHubTreeLister(gitHubConnection.token);
 *
 * <SessionViewer workspaceFileLister={fileLister} />
 * ```
 */
export function useGitHubTreeLister(
  token: string | null,
): WorkspaceFileLister | undefined {
  const lister = useCallback(
    async (entry: WorkspaceEntry): Promise<WorkspaceFileEntry[] | null> => {
      if (entry.type !== "git" || !entry.gitUrl || !token) return null;

      const parsed = parseGitUrl(entry.gitUrl);
      if (!parsed) return null;

      // readRef (the session's write-back commit SHA, when one exists) wins
      // over the configured branch, so the tree includes agent-created files.
      // The Trees API accepts a branch name or a commit SHA interchangeably.
      const ref = entry.readRef || entry.gitBranch || "main";
      const url = `${GITHUB_TREES_API}/${parsed.owner}/${parsed.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;

      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!resp.ok) return null;

      const data: GitHubTreeResponse = await resp.json();

      const entries: WorkspaceFileEntry[] = data.tree
        .filter((node) => node.type === "blob" || node.type === "tree")
        .map((node) => ({
          path: node.path,
          isDirectory: node.type === "tree",
        }));

      if (data.truncated) {
        entries.push(TRUNCATION_MARKER);
      }

      return entries;
    },
    [token],
  );

  if (!token) return undefined;
  return lister;
}
