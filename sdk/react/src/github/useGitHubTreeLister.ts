"use client";

/**
 * A workspace file lister for GitHub repositories, through the server's
 * `getTree` RPC with the login saved in My vault: the page never holds the
 * token or calls api.github.com.
 */
import { useCallback } from "react";
import type { WorkspaceFileEntry, WorkspaceFileLister } from "../workspace/WorkspaceFileLister.js";
import type { WorkspaceEntry } from "../workspace/useWorkspaceEntries.js";
import { useStigmer } from "../hooks.js";
import { parseGitUrl } from "./parseGitUrl.js";

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
 * Creates a {@link WorkspaceFileLister} backed by the server's GitHub tree
 * read, at the entry's `readRef` (write-back commit) or `gitBranch`.
 *
 * Returns `null` for non-git entries, non-GitHub URLs and failed reads
 * (graceful degradation), and `undefined` as the lister itself when `org`
 * is `null` (GitHub not connected).
 *
 * @example
 * ```tsx
 * const gitHubConnection = useGitHubConnection(org);
 * const fileLister = useGitHubTreeLister(gitHubConnection.readOrg);
 *
 * <SessionViewer workspaceFileLister={fileLister} />
 * ```
 */
export function useGitHubTreeLister(
  org: string | null,
): WorkspaceFileLister | undefined {
  const stigmer = useStigmer();
  const lister = useCallback(
    async (entry: WorkspaceEntry): Promise<WorkspaceFileEntry[] | null> => {
      if (entry.type !== "git" || !entry.gitUrl || !org) return null;

      const parsed = parseGitUrl(entry.gitUrl);
      if (!parsed) return null;

      // readRef (the session's write-back commit SHA, when one exists) wins
      // over the configured branch, so the tree includes agent-created files.
      const ref = entry.readRef || entry.gitBranch || "main";

      let tree;
      try {
        tree = await stigmer.github.getTree({
          org,
          owner: parsed.owner,
          repo: parsed.repo,
          ref,
        });
      } catch {
        return null;
      }

      const entries: WorkspaceFileEntry[] = tree.entries.map((node) => ({
        path: node.path,
        isDirectory: node.isDirectory,
      }));
      if (tree.truncated) {
        entries.push(TRUNCATION_MARKER);
      }
      return entries;
    },
    [org, stigmer],
  );

  if (!org) return undefined;
  return lister;
}
