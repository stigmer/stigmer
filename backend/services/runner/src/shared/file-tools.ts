/**
 * Introspection of file-modifying tools, shared by every runner surface that
 * reacts to a file edit: the native (deepagents) streaming side-effects (publish,
 * git writeback, post-exec file-change capture), the Cursor streaming capture,
 * and BOTH harnesses' approval-gate pre-execution capture (shared/gate-file-change.ts).
 *
 * This is the single source of truth for "which tools mutate files" and "where
 * their path / whole-file content / edit replacement lives in the tool
 * arguments". It is deliberately pure — no IO, no proto knowledge — so the same
 * identification logic is used whether args come from a streamed `on_tool_*`
 * event, a v3 protocol event, an AI-message tool call read out of graph state at
 * an interrupt, or the Cursor preToolUse hook's captured `tool_input`.
 *
 * Both taxonomies are covered in one place on purpose: the deepagents harness
 * names a file write `write_file`/`write`, the Cursor SDK stream names it
 * `edit`/`write`, and the Cursor preToolUse hook names it `Write`/`StrReplace`/
 * `EditNotebook`. The four extractors below span every arg-field name these
 * surfaces use, so a single capture path is correct for all of them.
 *
 * @since First-Class Diff Review (#186); cross-harness gate unification (HITL diff)
 */

import { createHash } from "node:crypto";

/**
 * The file-modifying tools, across both harness taxonomies.
 *
 * - deepagents (native): `write_file`/`edit_file`/`create_file` (stream) and
 *   `write`/`edit`/`create`/`str_replace_editor` (SDK names);
 * - Cursor: `write`/`edit` (SDK stream, shared with native) and
 *   `Write`/`StrReplace`/`EditNotebook` (preToolUse hook + tool names).
 *
 * Delete is intentionally absent: it has no whole-file content or hunk to
 * preview, so it is not "file-modifying" in the diff-capture sense.
 */
export const FILE_MODIFYING_TOOLS: ReadonlySet<string> = new Set([
  // deepagents (native) taxonomy
  "write_file", "edit_file", "create_file",
  "write", "edit", "create",
  "str_replace_editor",
  // Cursor taxonomy (PascalCase preToolUse hook + tool names; `write`/`edit`
  // above are shared with the SDK stream).
  "Write", "StrReplace", "EditNotebook",
]);

/** Whether `toolName` is a file-modifying tool in either harness taxonomy. */
export function isFileModifyingTool(toolName: string): boolean {
  return FILE_MODIFYING_TOOLS.has(toolName);
}

/**
 * Extract the target file path from a file-modifying tool's arguments. Returns
 * `null` when no recognized path key is present. The key set is the union across
 * both taxonomies: deepagents/Cursor write+edit use `path`/`file_path`; a Cursor
 * notebook edit uses `target_notebook`; the rest are defensive against drift.
 */
export function extractFilePath(args: Record<string, unknown>): string | null {
  if (typeof args.path === "string") return args.path;
  if (typeof args.file_path === "string") return args.file_path;
  if (typeof args.filePath === "string") return args.filePath;
  if (typeof args.filename === "string") return args.filename;
  if (typeof args.file === "string") return args.file;
  if (typeof args.target_notebook === "string") return args.target_notebook;
  return null;
}

/**
 * Top-level arg keys, in priority order, that carry a write-family tool's
 * WHOLE-FILE body, across both harness taxonomies (Cursor `Write` uses
 * `content`; the SDK stream uses `contents`). Exported so the generated Cursor
 * hook injects the SAME list into its inline content-digest extractor — the
 * field names diverge across the hook/stream layers, so a single shared list is
 * what keeps the runner-side and hook-side digests byte-identical.
 */
export const WRITE_CONTENT_FIELDS = ["content", "contents", "file_content"] as const;

/**
 * Extract the WHOLE-FILE content from a write-family tool's arguments. Returns
 * `null` for an edit-family call (which carries `old_string`/`new_string`, not a
 * whole-file body) or when no content key is present. An empty string is a real
 * value (an empty file) and is preserved.
 *
 * Critical: this is kept strictly separate from {@link extractEditNewString}.
 * `new_string` is an edit replacement fragment, NOT whole-file content;
 * conflating the two would make an edit look like a whole-file capture and read
 * the wrong `before` at the gate.
 */
export function extractWriteContent(args: Record<string, unknown>): string | null {
  for (const field of WRITE_CONTENT_FIELDS) {
    const v = args[field];
    if (typeof v === "string") return v;
  }
  return null;
}

/**
 * Top-level arg keys for an edit-family tool's pre-/post-edit fragments, across
 * both taxonomies. Exported for the same reason as {@link WRITE_CONTENT_FIELDS}:
 * the Cursor hook injects them into its inline digest extractor so its content
 * digest matches the runner's byte-for-byte.
 */
export const EDIT_OLD_FIELDS = ["old_string", "old_text", "oldText"] as const;
export const EDIT_NEW_FIELDS = ["new_string", "new_text", "newText", "replacement"] as const;

/**
 * Extract an edit-family tool's pre-edit fragment (`old_string` and its
 * variants). Returns `null` when absent; an empty string is preserved (an
 * insertion has an empty `old_string`), matching the native gate capture.
 */
export function extractEditOldString(args: Record<string, unknown>): string | null {
  for (const field of EDIT_OLD_FIELDS) {
    const v = args[field];
    if (typeof v === "string") return v;
  }
  return null;
}

/**
 * Extract an edit-family tool's post-edit fragment (`new_string` and its
 * variants, including `replacement`). Returns `null` when absent; an empty
 * string is preserved (a deletion has an empty `new_string`).
 */
export function extractEditNewString(args: Record<string, unknown>): string | null {
  for (const field of EDIT_NEW_FIELDS) {
    const v = args[field];
    if (typeof v === "string") return v;
  }
  return null;
}

/**
 * Stable content digest of a file-mutating tool call's arguments — the content
 * discriminator the deny-only Cursor HITL identity adds on top of
 * (category, path) so a DIFFERENT edit to the same file re-gates rather than
 * riding an earlier approval through.
 *
 * It hashes ONLY the edit content, never the path (the path is the identity's
 * "salient" already). A whole-file write hashes its body; an edit hashes its
 * (old, new) fragment pair. Returns "" for a call with no recoverable edit
 * content — a shell command, a delete, a read, an MCP tool, or the hook's
 * grep-fallback denial — which keep the coarse (category, salient) identity
 * (already content-exact for a command / delete path).
 *
 * THE FORMAT IS A CROSS-LAYER CONTRACT. The Cursor preToolUse hook recomputes
 * this digest inline from `tool_input`, running the SAME Node binary as the
 * runner (see buildContentDigestScript in execute-cursor/hook-script.ts), so the
 * two values must be byte-identical — any change here MUST be mirrored there.
 * JSON.stringify of a fixed-shape string array is deterministic and identical on
 * both sides; the leading tag ("w"/"e") keeps a write body from ever colliding
 * with an edit pair, and the union field lists above are injected into the hook
 * so both extract the same value despite the file_path/path & content/contents
 * cross-layer name divergence.
 */
export function contentDigest(args: Record<string, unknown>): string {
  const content = extractWriteContent(args);
  if (content !== null) {
    return sha256Hex(JSON.stringify(["w", content]));
  }
  const oldString = extractEditOldString(args);
  const newString = extractEditNewString(args);
  if (oldString !== null || newString !== null) {
    return sha256Hex(JSON.stringify(["e", oldString ?? "", newString ?? ""]));
  }
  return "";
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}
