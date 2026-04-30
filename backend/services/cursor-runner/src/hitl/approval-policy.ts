/**
 * Tool approval policy evaluation for the Cursor harness.
 *
 * Determines whether a Cursor tool call requires user approval before
 * execution. This is the Cursor-harness equivalent of the Python runner's
 * approval_policy.py.
 *
 * Policy sources:
 * 1. Built-in Cursor tool defaults (runner-local, not proto-driven)
 * 2. Session-level auto_approve_all flag (from ExecutionSpec)
 * 3. Future: per-agent or per-org policies
 *
 * Built-in tool defaults follow the T02 design decision:
 * - Require approval: Shell, Delete (destructive operations)
 * - Allow by default: Read, Grep, Glob, SemanticSearch (read-only)
 * - Configurable: Write, Task (default: allow)
 */

const REQUIRE_APPROVAL_BY_DEFAULT = new Set([
  "Shell",
  "Delete",
]);

const ALLOW_BY_DEFAULT = new Set([
  "Read",
  "Grep",
  "Glob",
  "SemanticSearch",
  "WebSearch",
  "WebFetch",
  "Write",
  "StrReplace",
  "EditNotebook",
  "Task",
  "SwitchMode",
  "AskQuestion",
  "GenerateImage",
  "ReadLints",
]);

export interface ApprovalPolicyOptions {
  autoApproveAll?: boolean;
}

/**
 * Check whether a tool call requires user approval.
 *
 * @param toolName - The Cursor tool name from the preToolUse hook input
 * @param options - Policy options (e.g., auto_approve_all)
 * @returns true if the tool requires approval, false if auto-approved
 */
export function requiresApproval(
  toolName: string,
  options: ApprovalPolicyOptions = {},
): boolean {
  if (options.autoApproveAll) {
    return false;
  }

  if (REQUIRE_APPROVAL_BY_DEFAULT.has(toolName)) {
    return true;
  }

  if (ALLOW_BY_DEFAULT.has(toolName)) {
    return false;
  }

  // MCP tools (format: "MCP: server_name/tool_name") default to requiring approval
  if (toolName.startsWith("MCP:")) {
    return true;
  }

  // Unknown tools: require approval (fail-closed)
  return true;
}
