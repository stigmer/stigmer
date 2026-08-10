"use client";

import { useCallback } from "react";
import type { WorkspaceEntry } from "../workspace/useWorkspaceEntries.js";
import {
  WorkspaceFileNotFoundError,
  workspaceImageMimeType,
  type WorkspaceFileContent,
  type WorkspaceFileReader,
} from "../workspace/WorkspaceFileReader.js";
import { base64ToBytes, normalizeGitHubContent } from "./decodeGitHubContent.js";
import { parseGitUrl } from "./parseGitUrl.js";

const GITHUB_API = "https://api.github.com/repos";

/**
 * Upper bound on files we will pull through the Blob API (Gate 1, Option B).
 *
 * The Contents API caps at ~1 MB and signals larger files with
 * `encoding: "none"`; the Blob API then serves them in full (up to GitHub's own
 * ~100 MB blob limit). Since we only ever display the first ~1 MB, downloading
 * a 90 MB blob to show 1 MB is wasteful — so above this ceiling we report the
 * file as too-large
 * (`text: null`, `truncated: true`) using the size GitHub already told us,
 * without downloading anything.
 */
const BLOB_FETCH_CEILING_BYTES = 10 * 1024 * 1024; // 10 MiB

/** Single-file shape of `GET /repos/{o}/{r}/contents/{path}`. */
interface GitHubContentsFile {
  readonly encoding: "base64" | "none";
  readonly size: number;
  readonly content: string;
  readonly sha: string;
}

/** Shape of `GET /repos/{o}/{r}/git/blobs/{sha}`. */
interface GitHubBlob {
  readonly encoding: "base64";
  readonly size: number;
  readonly content: string;
}

/** Encode a repo-relative path per segment, preserving the slashes. */
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * Creates a {@link WorkspaceFileReader} backed by the GitHub Contents API,
 * with a Blob-API fallback for files above the Contents 1 MB cap.
 *
 * Uses the same client-side OAuth token as {@link useGitHubTreeLister}
 * (`Authorization: Bearer`), inheriting its private-repo scope. Returns
 * `undefined` when no token is present, mirroring the tree lister so callers
 * can treat "no reader" and "no lister" identically.
 *
 * The reader itself:
 * - Returns `null` when the entry is not a readable GitHub git repo
 *   (non-git entry, missing/unparseable URL) — the "unsupported here" state.
 * - **Throws** on a real failure: a non-OK response, or a directory path
 *   (which the Contents API returns as a JSON array). Consumers surface these
 *   as an error, distinct from the null "unsupported" state. A 404 throws the
 *   typed {@link WorkspaceFileNotFoundError} so consumers can fall back to
 *   session-captured content for files not yet pushed to the ref.
 *
 * @example
 * ```tsx
 * const gitHubConnection = useGitHubConnection(org);
 * const fileReader = useGitHubFileReader(gitHubConnection.token);
 * <SessionViewer workspaceFileReader={fileReader} />
 * ```
 */
export function useGitHubFileReader(
  token: string | null,
): WorkspaceFileReader | undefined {
  const reader = useCallback(
    async (
      entry: WorkspaceEntry,
      path: string,
    ): Promise<WorkspaceFileContent | null> => {
      if (entry.type !== "git" || !entry.gitUrl || !token) return null;

      const parsed = parseGitUrl(entry.gitUrl);
      if (!parsed) return null;

      // readRef (the session's write-back commit SHA, when one exists) wins
      // over the configured branch: agent-created files live on the pushed
      // write-back commit, not the base branch. The Contents API accepts a
      // branch name or a commit SHA interchangeably as `ref`.
      const ref = entry.readRef || entry.gitBranch || "main";
      const url =
        `${GITHUB_API}/${parsed.owner}/${parsed.repo}/contents/${encodePath(path)}` +
        `?ref=${encodeURIComponent(ref)}`;

      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      // 404 is typed: a file that isn't at this ref (yet) is an expected,
      // recoverable state — e.g. an agent-created file whose write-back
      // hasn't pushed — that consumers handle differently from a failure.
      if (resp.status === 404) {
        throw new WorkspaceFileNotFoundError(path);
      }
      if (!resp.ok) {
        throw new Error(
          `GitHub content fetch failed for ${path} (HTTP ${resp.status})`,
        );
      }

      const data: unknown = await resp.json();
      // The Contents API returns an array for a directory — a misdirected read,
      // not an unsupported substrate, so fail loudly rather than return null.
      if (Array.isArray(data)) {
        throw new Error(`Cannot read "${path}": path is a directory`);
      }

      const file = data as GitHubContentsFile;
      if (file.encoding === "base64") {
        return normalizeGitHubContent(
          base64ToBytes(file.content),
          file.size,
          workspaceImageMimeType(path),
        );
      }

      // encoding: "none" is GitHub's signal that the file exceeds the Contents
      // API's ~1 MB cap; the bytes live only behind the Blob API.
      return readViaBlob(parsed, file, path, token);
    },
    [token],
  );

  if (!token) return undefined;
  return reader;
}

/**
 * Gate 1 / Option B — size-gated blob fetch for files the Contents API refused
 * (`encoding: "none"`). Isolated so the large-file policy can change without
 * touching the reader's control flow.
 */
async function readViaBlob(
  parsed: { owner: string; repo: string },
  file: GitHubContentsFile,
  path: string,
  token: string,
): Promise<WorkspaceFileContent> {
  // Above the ceiling we never download — GitHub already told us the size, so
  // report it as too-large-to-preview without spending the bandwidth.
  if (file.size > BLOB_FETCH_CEILING_BYTES) {
    return {
      text: null,
      isBinary: false,
      size: file.size,
      encoding: "none",
      truncated: true,
    };
  }

  const url = `${GITHUB_API}/${parsed.owner}/${parsed.repo}/git/blobs/${file.sha}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    throw new Error(`GitHub blob fetch failed for ${file.sha} (HTTP ${resp.status})`);
  }

  const blob: GitHubBlob = await resp.json();
  return normalizeGitHubContent(
    base64ToBytes(blob.content),
    blob.size,
    workspaceImageMimeType(path),
  );
}
