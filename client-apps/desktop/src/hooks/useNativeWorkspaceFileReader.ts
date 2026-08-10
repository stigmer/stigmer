import { useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  WorkspaceEntry,
  WorkspaceFileContent,
  WorkspaceFileReader,
} from "@stigmer/react";

/**
 * The Rust `ReadResult` shape: `WorkspaceFileContent` minus `bytes`, plus the
 * base64 transport field for image bytes — Tauri's invoke boundary is JSON,
 * so raw bytes ride encoded and are decoded here (stigmer/stigmer#379).
 */
type NativeReadResult = Omit<WorkspaceFileContent, "bytes"> & {
  readonly imageBase64?: string;
};

/**
 * Returns a stable {@link WorkspaceFileReader} that reads local workspace file
 * content via the Rust `read_workspace_file` command.
 *
 * - For `entry.type === "local"` entries, invokes the command with the entry's
 *   root and the repo/root-relative `path`. The Rust side enforces the 1 MB
 *   cap (10 MB for whole-image reads), NUL-byte binary detection, and
 *   path-traversal rejection, and returns the `WorkspaceFileContent` shape
 *   directly — with image bytes base64-encoded, decoded to `bytes` here.
 * - Returns `null` for non-local entries (git content is not readable on
 *   desktop — the runner clones repos at execution time), mirroring
 *   `useNativeWorkspaceFiles`.
 * - Real failures (missing file, directory, unreadable) surface as a rejected
 *   invoke and propagate to the caller — never collapsed into `null`.
 */
export function useNativeWorkspaceFileReader(): WorkspaceFileReader {
  return useCallback(
    async (entry: WorkspaceEntry, path: string): Promise<WorkspaceFileContent | null> => {
      if (entry.type !== "local" || !entry.localPath) return null;

      const result = await invoke<NativeReadResult>("read_workspace_file", {
        root: entry.localPath,
        relativePath: path,
      });

      // The common (non-image) case passes through untouched — same object,
      // no copy. Rust omits the field entirely when there is no image.
      if (result.imageBase64 === undefined) return result;

      // Rust's standard base64 engine emits no line wrapping, so atob takes
      // it directly (unlike GitHub's newline-wrapped payloads).
      const { imageBase64, ...content } = result;
      const binary = atob(imageBase64);
      return { ...content, bytes: Uint8Array.from(binary, (ch) => ch.charCodeAt(0)) };
    },
    [],
  );
}
