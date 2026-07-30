/**
 * Harness-agnostic tool classification for the runner.
 *
 * Both harnesses emit engine-specific tool names — the native (deepagents)
 * harness uses snake_case (edit_file, execute, grep), the Cursor harness uses
 * PascalCase (StrReplace, Shell, Grep). This module is the single place that
 * maps a tool name to the wire-level ToolKind, so every client renders a tool
 * the same way regardless of which harness produced it.
 *
 * The SDK fallback resolver and the Go CLI mirror this mapping. The shared,
 * machine-checked contract is test/fixtures/tool-view/classification.json — keep
 * this table and that fixture in lockstep.
 */

import { ToolKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

// Bare tool name -> ToolKind, covering both harness naming conventions. A name
// found here is a built-in and wins over a non-empty mcp_server_slug (an MCP
// server is not expected to shadow a built-in name; matching the legacy resolver).
const TOOL_NAME_TO_KIND: ReadonlyMap<string, ToolKind> = new Map([
  ["read", ToolKind.FILE_READ],
  ["read_file", ToolKind.FILE_READ],
  ["Read", ToolKind.FILE_READ],

  ["write", ToolKind.FILE_WRITE],
  ["write_file", ToolKind.FILE_WRITE],
  ["create_file", ToolKind.FILE_WRITE],
  ["overwrite_file", ToolKind.FILE_WRITE],
  ["Write", ToolKind.FILE_WRITE],

  ["edit", ToolKind.FILE_EDIT],
  ["edit_file", ToolKind.FILE_EDIT],
  ["str_replace_editor", ToolKind.FILE_EDIT],
  ["StrReplace", ToolKind.FILE_EDIT],
  ["EditNotebook", ToolKind.FILE_EDIT],

  ["delete", ToolKind.FILE_DELETE],
  ["delete_file", ToolKind.FILE_DELETE],
  ["remove_file", ToolKind.FILE_DELETE],
  ["Delete", ToolKind.FILE_DELETE],

  ["shell", ToolKind.SHELL],
  ["bash", ToolKind.SHELL],
  ["execute", ToolKind.SHELL],
  ["execute_command", ToolKind.SHELL],
  ["run_command", ToolKind.SHELL],
  ["terminal", ToolKind.SHELL],
  ["Shell", ToolKind.SHELL],

  ["grep", ToolKind.SEARCH],
  ["glob", ToolKind.SEARCH],
  ["search", ToolKind.SEARCH],
  ["ripgrep", ToolKind.SEARCH],
  ["find_files", ToolKind.SEARCH],
  ["Grep", ToolKind.SEARCH],
  ["Glob", ToolKind.SEARCH],
  ["SemanticSearch", ToolKind.SEARCH],

  ["ls", ToolKind.LIST],
  ["list_directory", ToolKind.LIST],

  ["web_fetch", ToolKind.FETCH],
  ["WebFetch", ToolKind.FETCH],
  ["WebSearch", ToolKind.WEB_SEARCH],

  ["think", ToolKind.THINK],

  ["write_todos", ToolKind.TODO],
  ["updateTodos", ToolKind.TODO],
  ["TodoWrite", ToolKind.TODO],

  ["task", ToolKind.SUBAGENT],
  ["Task", ToolKind.SUBAGENT],
]);

/**
 * Classifies a tool call into its harness-agnostic ToolKind.
 *
 * Built-in names are matched first; any unrecognized name with a non-empty
 * mcpServerSlug is an MCP tool; everything else is UNSPECIFIED (clients fall
 * back to a name lookup, so this is never worse than no classification).
 */
export function classifyTool(name: string, mcpServerSlug?: string): ToolKind {
  const builtin = TOOL_NAME_TO_KIND.get(name);
  if (builtin !== undefined) {
    return builtin;
  }
  if (mcpServerSlug && mcpServerSlug.length > 0) {
    return ToolKind.MCP;
  }
  return ToolKind.UNSPECIFIED;
}

/**
 * The coarse, cross-taxonomy approval category of a gated built-in tool, or
 * undefined for tools that are not gated by category (read-only built-ins, MCP
 * tools, and unknown names).
 *
 * FILE_WRITE and FILE_EDIT both collapse to "write" on purpose: the Cursor
 * preToolUse hook reports every file mutation — create or edit — as `Write`,
 * while the SDK stream names them `edit`/`write`. The category is therefore the
 * only tool identity that is stable across the hook and stream taxonomies, which
 * is exactly what the Cursor approval grant (and the Phase-2 coarse approval
 * fingerprint) must match on. Built on {@link classifyTool} so this collapse is
 * defined once.
 *
 * This is the single source of truth for the approval category;
 * execute-cursor/approval-policy.ts re-exports it so the two harnesses cannot
 * drift.
 */
export type ToolApprovalCategory = "write" | "delete" | "shell";

export function toolApprovalCategory(name: string): ToolApprovalCategory | undefined {
  switch (classifyTool(name)) {
    case ToolKind.FILE_WRITE:
    case ToolKind.FILE_EDIT:
      return "write";
    case ToolKind.FILE_DELETE:
      return "delete";
    case ToolKind.SHELL:
      return "shell";
    // FETCH is deliberately uncategorized — i.e. auto-approved. This mirrors
    // the Cursor harness (WebFetch is never gated) and is what makes the
    // native web_fetch usable in unattended runs, where a gated tool is
    // silently skipped. The safety boundary for web_fetch is its URL guard
    // (tools/url-guard.ts), not the approval gate.
    default:
      return undefined;
  }
}
