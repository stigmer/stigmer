/**
 * Introspection of the native (deepagents) file-modifying tools, shared by every
 * runner surface that reacts to a file edit: the v2/v3 streaming side-effects
 * (publish, git writeback, post-exec file-change capture) and the approval-gate
 * pre-execution capture.
 *
 * This is the single source of truth for "which tools mutate files" and "where
 * their path / content lives in the tool arguments". It is deliberately pure —
 * no IO, no proto knowledge — so the same identification logic is used whether
 * args come from a streamed `on_tool_*` event, a v3 protocol event, or an
 * AI-message tool call read out of graph state at an interrupt.
 *
 * @since First-Class Diff Review (#186)
 */

/**
 * The deepagents file-modifying tools. `write`/`create` produce whole-file
 * content; `edit`/`str_replace_editor` produce an `old_string`/`new_string`
 * replacement. Both stream-named (`write_file`) and SDK-named (`write`) variants
 * are listed because the two harness paths observe different names.
 */
export const FILE_MODIFYING_TOOLS: ReadonlySet<string> = new Set([
  "write_file", "edit_file", "create_file",
  "write", "edit", "create",
  "str_replace_editor",
]);

/** Whether `toolName` is a deepagents file-modifying tool. */
export function isFileModifyingTool(toolName: string): boolean {
  return FILE_MODIFYING_TOOLS.has(toolName);
}

/**
 * Extract the target file path from a file-modifying tool's arguments. Returns
 * `null` when no recognized path key is present. The key set is the superset
 * across deepagents tool variants (`file_path` for write/edit; the others are
 * defensive against naming drift).
 */
export function extractFilePath(args: Record<string, unknown>): string | null {
  if (typeof args.path === "string") return args.path;
  if (typeof args.file_path === "string") return args.file_path;
  if (typeof args.filePath === "string") return args.filePath;
  if (typeof args.filename === "string") return args.filename;
  if (typeof args.file === "string") return args.file;
  return null;
}

/**
 * Extract the whole-file content from a write-family tool's arguments. Returns
 * `null` for an edit-family call (which carries `old_string`/`new_string`, not a
 * whole-file body) or when no content key is present. An empty string is a real
 * value (an empty file) and is preserved.
 */
export function extractWriteContent(args: Record<string, unknown>): string | null {
  if (typeof args.content === "string") return args.content;
  if (typeof args.contents === "string") return args.contents;
  return null;
}
