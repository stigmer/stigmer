/**
 * Introspection of file-modifying tools, shared by every runner surface that
 * reacts to a file edit: the Stigmer (deepagents) streaming side-effects (publish,
 * git writeback, post-exec file-change capture) and BOTH harnesses'
 * approval-gate pre-execution capture (shared/gate-file-change.ts).
 *
 * This is the single source of truth for "which tools mutate files" and "where
 * their path / whole-file content / edit replacement lives in the tool
 * arguments". It is deliberately pure — no IO, no proto knowledge — so the same
 * identification logic is used whether args come from a streamed `on_tool_*`
 * event, a v3 protocol event, an AI-message tool call read out of graph state at
 * an interrupt, or the Claude engine's gated call.
 *
 * Every taxonomy is covered in one place on purpose: the deepagents harness
 * names a file write `write_file`/`write`, and Claude Code `Write`/`Edit`/
 * `NotebookEdit`. The four extractors below span every arg-field name these
 * surfaces use, so a single capture path is correct for all of them.
 */

/**
 * The file-modifying tools, across both harness taxonomies.
 *
 * - deepagents (Stigmer): `write_file`/`edit_file`/`create_file` (stream) and
 *   `write`/`edit`/`create`/`str_replace_editor` (SDK names);
 * - Claude: `Write`, `Edit`, `NotebookEdit`.
 *
 * Delete is intentionally absent: it has no whole-file content or hunk to
 * preview, so it is not "file-modifying" in the diff-capture sense.
 */
export const FILE_MODIFYING_TOOLS: ReadonlySet<string> = new Set([
  // deepagents (Stigmer) taxonomy
  "write_file", "edit_file", "create_file",
  "write", "edit", "create",
  "str_replace_editor",
  // Claude Code's own names.
  "Write", "Edit", "NotebookEdit",
]);

/** Whether `toolName` is a file-modifying tool in either harness taxonomy. */
export function isFileModifyingTool(toolName: string): boolean {
  return FILE_MODIFYING_TOOLS.has(toolName);
}

/**
 * Extract the target file path from a file-modifying tool's arguments. Returns
 * `null` when no recognized path key is present. The key set is the union across
 * every taxonomy: deepagents and Claude write+edit use `path`/`file_path`; a
 * Claude notebook edit uses `notebook_path`; the rest are defensive against
 * drift.
 */
export function extractFilePath(args: Record<string, unknown>): string | null {
  if (typeof args.path === "string") return args.path;
  if (typeof args.file_path === "string") return args.file_path;
  if (typeof args.filePath === "string") return args.filePath;
  if (typeof args.filename === "string") return args.filename;
  if (typeof args.file === "string") return args.file;
  if (typeof args.notebook_path === "string") return args.notebook_path;
  return null;
}

/**
 * Top-level arg keys, in priority order, that carry a write-family tool's
 * WHOLE-FILE body, across both harness taxonomies (deepagents' and Claude's
 * `Write` use `content`; the others are defensive against drift). Exported so
 * the secret-key set is held apart from every field a row's args are acted
 * on by (`__tests__/args-preview.test.ts`).
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
 * both taxonomies. Exported for the same reason as {@link WRITE_CONTENT_FIELDS}.
 */
export const EDIT_OLD_FIELDS = ["old_string", "old_text", "oldText"] as const;
export const EDIT_NEW_FIELDS = ["new_string", "new_text", "newText", "replacement"] as const;

/**
 * Extract an edit-family tool's pre-edit fragment (`old_string` and its
 * variants). Returns `null` when absent; an empty string is preserved (an
 * insertion has an empty `old_string`), matching the Stigmer harness's gate capture.
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
