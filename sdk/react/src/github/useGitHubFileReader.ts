"use client";

/**
 * A workspace file reader for GitHub repositories, through the server's
 * `getFileContent` RPC with the login saved in My vault: the page never
 * holds the token or calls api.github.com. Files above the server's
 * ceiling come back by size alone, reported as too large to preview.
 */
import { useCallback } from "react";
import { isNotFound } from "@stigmer/sdk";
import type { WorkspaceEntry } from "../workspace/useWorkspaceEntries.js";
import {
  WorkspaceFileNotFoundError,
  workspaceImageMimeType,
  type WorkspaceFileContent,
  type WorkspaceFileReader,
} from "../workspace/WorkspaceFileReader.js";
import { useStigmer } from "../hooks.js";
import { normalizeGitHubContent } from "./decodeGitHubContent.js";
import { parseGitUrl } from "./parseGitUrl.js";

/**
 * Creates a {@link WorkspaceFileReader} backed by the server's GitHub
 * file read.
 *
 * Returns `undefined` when `org` is `null` (GitHub not connected),
 * mirroring the tree lister so callers can treat "no reader" and "no
 * lister" identically.
 *
 * The reader itself:
 * - Returns `null` when the entry is not a readable GitHub git repo
 *   (non-git entry, missing/unparseable URL) — the "unsupported here" state.
 * - Throws {@link WorkspaceFileNotFoundError} when the file is not at the
 *   ref, so consumers can fall back to session-captured content for files
 *   not yet pushed; throws plainly on any other failure.
 *
 * @example
 * ```tsx
 * const gitHubConnection = useGitHubConnection(org);
 * const fileReader = useGitHubFileReader(gitHubConnection.readOrg);
 * <SessionViewer workspaceFileReader={fileReader} />
 * ```
 */
export function useGitHubFileReader(
  org: string | null,
): WorkspaceFileReader | undefined {
  const stigmer = useStigmer();
  const reader = useCallback(
    async (
      entry: WorkspaceEntry,
      path: string,
    ): Promise<WorkspaceFileContent | null> => {
      if (entry.type !== "git" || !entry.gitUrl || !org) return null;

      const parsed = parseGitUrl(entry.gitUrl);
      if (!parsed) return null;

      // readRef (the session's write-back commit SHA, when one exists) wins
      // over the configured branch: agent-created files live on the pushed
      // write-back commit, not the base branch.
      const ref = entry.readRef || entry.gitBranch || "main";

      let file;
      try {
        file = await stigmer.github.getFileContent({
          org,
          owner: parsed.owner,
          repo: parsed.repo,
          ref,
          path,
        });
      } catch (err) {
        if (isNotFound(err)) throw new WorkspaceFileNotFoundError(path);
        throw err;
      }

      const size = Number(file.size);
      if (file.tooLarge) {
        return { text: null, isBinary: false, size, encoding: "none", truncated: true };
      }
      return normalizeGitHubContent(file.content, size, workspaceImageMimeType(path));
    },
    [org, stigmer],
  );

  if (!org) return undefined;
  return reader;
}
