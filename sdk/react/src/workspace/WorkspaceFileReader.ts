// Content-fetch capability — the byte-reading sibling of WorkspaceFileLister.
// Domain: workspace. Injected by the host (DD-004) so the SDK never learns how
// bytes are fetched: GitHub Contents/blob on web, Tauri fs on desktop.

import type { WorkspaceEntry } from "./useWorkspaceEntries.js";

/**
 * Shared soft cap for a single file read, enforced identically on web and
 * desktop so both substrates truncate at the same boundary. Files larger than
 * this return their first {@link MAX_WORKSPACE_FILE_READ_BYTES} bytes in `text`
 * with `truncated: true`; `size` still reports the full file size.
 */
export const MAX_WORKSPACE_FILE_READ_BYTES = 1_048_576; // 1 MiB

/**
 * Decoded content (plus metadata) for a single workspace file.
 *
 * `text` is `null` whenever the bytes are not displayable as UTF-8 — either
 * binary (`isBinary`) or an undecodable byte sequence (`encoding: "unknown"`).
 * The renderer uses `isBinary`/`text === null` for its fallback state.
 */
export interface WorkspaceFileContent {
  /** Decoded UTF-8 text, or `null` when binary or undecodable. */
  readonly text: string | null;
  /** Whether the bytes were detected as binary (NUL-byte heuristic). */
  readonly isBinary: boolean;
  /** Full file size in bytes — independent of truncation. */
  readonly size: number;
  /** How the backend delivered the bytes. `"none"` is GitHub's >1 MB signal. */
  readonly encoding: "utf-8" | "base64" | "none" | "unknown";
  /** `true` when `text` holds only the first {@link MAX_WORKSPACE_FILE_READ_BYTES} bytes. */
  readonly truncated?: boolean;
}

/**
 * Thrown by a {@link WorkspaceFileReader} when the requested path does not
 * exist at the entry's read ref — as opposed to a transport or permission
 * failure.
 *
 * The distinction matters to consumers: a file the agent just created exists
 * in session state before it exists at any readable ref, so "not found" is a
 * recoverable, expected condition (the viewer falls back to the session's
 * captured content), while a network error or 5xx is a genuine failure worth
 * a retry affordance. Platform builders implementing custom readers should
 * throw this class for their substrate's not-found condition.
 */
export class WorkspaceFileNotFoundError extends Error {
  constructor(path: string) {
    super(`"${path}" doesn't exist at the workspace's current ref.`);
    this.name = "WorkspaceFileNotFoundError";
  }
}

/**
 * Platform-injected callback that reads the content of a single workspace file.
 *
 * The byte-reading sibling of {@link WorkspaceFileLister}:
 * the SDK calls it when a user opens a file; the platform decides *how* the
 * bytes are fetched (GitHub on web, Tauri on desktop).
 *
 * Two distinct failure axes — do not conflate them:
 * - Returns `null` **only** when the substrate is unsupported for this entry
 *   (git-on-desktop, local-on-web, missing token, non-GitHub URL). This is the
 *   honest "unavailable here" state, mirroring the lister's null contract.
 * - **Throws** on a genuine failure (404, network error, 5xx, unreadable file,
 *   a directory path). Consumers catch this into a distinct error state — a
 *   clicked file that 404s is "failed to load," not "unsupported here."
 *   A missing path should throw {@link WorkspaceFileNotFoundError} so
 *   consumers can distinguish "not there yet" from "broken."
 *
 * `path` is repo-relative for git entries and root-relative for local entries —
 * exactly the strings the matching `WorkspaceFileLister` emits, so a file-tree
 * node path can be handed straight to the reader with no transformation.
 */
export type WorkspaceFileReader = (
  entry: WorkspaceEntry,
  path: string,
) => Promise<WorkspaceFileContent | null>;
