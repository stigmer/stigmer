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
 * Platform-injected callback that reads the content of a single workspace file.
 *
 * The byte-reading sibling of {@link import("./WorkspaceFileLister.js").WorkspaceFileLister}:
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
 *
 * `path` is repo-relative for git entries and root-relative for local entries —
 * exactly the strings the matching `WorkspaceFileLister` emits, so a file-tree
 * node path can be handed straight to the reader with no transformation.
 */
export type WorkspaceFileReader = (
  entry: WorkspaceEntry,
  path: string,
) => Promise<WorkspaceFileContent | null>;
