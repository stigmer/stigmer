/**
 * Coarse, cross-taxonomy approval category of a gated built-in tool — the
 * server's twin of toolApprovalCategory in
 * backend/services/runner/src/shared/tool-kind.ts.
 *
 * FILE_WRITE and FILE_EDIT both collapse to "write" on purpose: hook
 * formats and engines name a file mutation differently (a hook may report
 * every create or edit as `Write`, while a stream names them `edit` or
 * `write`). The category is therefore the only tool identity stable across
 * the hook and stream taxonomies. This table must stay in lockstep with the runner's
 * TOOL_NAME_TO_KIND map (the machine-checked contract for the full
 * classification lives in the runner's classification.json fixture; the
 * subset reproduced here is only the gated, mutating names the category
 * needs).
 */

/**
 * Built-in tool name (either harness's naming) → approval category. Only
 * mutating built-ins appear; everything else (read-only built-ins, MCP
 * tools, unknown names) has no category and is matched by other means.
 */
const TOOL_NAME_TO_CATEGORY: ReadonlyMap<string, string> = new Map([
  // FILE_WRITE + FILE_EDIT collapse to "write".
  ["write", "write"],
  ["write_file", "write"],
  ["create_file", "write"],
  ["overwrite_file", "write"],
  ["Write", "write"],
  ["edit", "write"],
  ["edit_file", "write"],
  ["str_replace_editor", "write"],
  ["Edit", "write"],
  ["NotebookEdit", "write"],

  // FILE_DELETE.
  ["delete", "delete"],
  ["delete_file", "delete"],
  ["remove_file", "delete"],

  // SHELL.
  ["shell", "shell"],
  ["bash", "shell"],
  ["execute", "shell"],
  ["execute_command", "shell"],
  ["run_command", "shell"],
  ["terminal", "shell"],
  ["Bash", "shell"],
]);

/**
 * The approval category ("write"/"delete"/"shell") of a gated built-in
 * tool; undefined for tools not gated by category (read-only built-ins,
 * MCP tools, unknown names).
 */
export function toolApprovalCategory(name: string): string | undefined {
  return TOOL_NAME_TO_CATEGORY.get(name);
}
