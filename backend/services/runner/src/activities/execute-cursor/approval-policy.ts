/**
 * Tool approval policy evaluation for the Cursor harness.
 *
 * Implements the four-level policy chain documented in the ToolCall proto:
 *
 * 1. McpServerStatus.tool_approvals — system-generated defaults from the
 *    LLM classifier during the connect flow.
 * 2. McpServerSpec.pinned_tool_approvals — manual overrides by the server
 *    owner. Presence in the list means "requires approval."
 * 3. McpServerUsage.tool_approval_overrides — per-agent customization with
 *    an explicit requires_approval boolean.
 * 4. AgentExecutionSpec.auto_approve_all — runtime bypass (highest priority).
 *
 * For MCP tools, the merged result determines whether the preToolUse hook
 * allows or denies the call. For built-in Cursor tools (Shell, Read, etc.),
 * a separate local policy applies.
 */

import { ToolKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { classifyTool } from "../../shared/tool-kind.js";

// The four-level MCP policy merge is harness-agnostic and lives in exactly one
// place (shared/approval-policy.ts) so the Cursor and native harnesses can never
// diverge. Re-exported here so existing Cursor-harness imports
// (`from "./approval-policy.js"`) keep working unchanged. This module now owns
// only the Cursor-specific built-in-tool gating helpers below.
export {
  mergeApprovalPolicies,
  lookupMcpToolPolicy,
  resolveApprovalMessage,
} from "../../shared/approval-policy.js";
export type { MergedToolPolicy } from "../../shared/approval-policy.js";

/**
 * Built-in Cursor tools the preToolUse hook gates, named as the hook receives
 * them.
 *
 * Critical: the Cursor preToolUse hook and the SDK event stream use DIFFERENT
 * tool taxonomies for the same operation. The hook's `tool_name` is PascalCase
 * (`Write` for any file create/edit, `Shell`, `Delete`); the stream's
 * `event.name` is lowercase (`edit`, `shell`, `delete`). This set is the HOOK
 * taxonomy because it is consulted only to build the hook's gated set and its
 * name->category mapping. Cross-layer correlation never compares these raw
 * names — it uses {@link approvalCategory} (see below).
 */
const BUILT_IN_GATED: ReadonlySet<string> = new Set([
  "Write",
  "StrReplace",
  "EditNotebook",
  "Shell",
  "Delete",
]);

/**
 * Canonical approval category for a gated tool, derived from EITHER taxonomy's
 * name via the shared {@link classifyTool}.
 *
 * The hook (`Write`/`Shell`/`Delete`) and the stream (`edit`/`shell`/`delete`)
 * name the same operation differently, so neither raw name is a stable
 * cross-layer identity. The category collapses both onto one value so the denial
 * ledger (recorded by the hook) correlates to the streamed tool call (read by
 * the runner) and so an approval grant matches the agent's re-attempt on
 * reinvocation regardless of which taxonomy named it. `FILE_WRITE` and
 * `FILE_EDIT` both map to `write` because the Cursor hook reports every file
 * mutation — create or edit — as `Write`.
 *
 * Returns undefined for non-gated tools (read-only built-ins, MCP tools, and
 * anything `classifyTool` does not place in a mutating kind).
 */
export type ApprovalCategory = "write" | "delete" | "shell";

export function approvalCategory(toolName: string): ApprovalCategory | undefined {
  switch (classifyTool(toolName)) {
    case ToolKind.FILE_WRITE:
    case ToolKind.FILE_EDIT:
      return "write";
    case ToolKind.FILE_DELETE:
      return "delete";
    case ToolKind.SHELL:
      return "shell";
    default:
      return undefined;
  }
}

/**
 * Human-readable approval-message template per canonical category. Keyed by
 * category (not raw tool name) so a denial surfaced from either taxonomy renders
 * the same message. Placeholders resolve against the tool args via
 * {@link resolveApprovalMessage}; `{{args.path}}` and `{{args.command}}` are the
 * stream-side field names (the runner builds the approval surface from the
 * streamed tool call, whose args use `path`/`command`).
 */
const CATEGORY_APPROVAL_MESSAGE: Record<ApprovalCategory, string> = {
  write: "Write file: {{args.path}}",
  delete: "Delete: {{args.path}}",
  shell: "Run command: {{args.command}}",
};

/**
 * Top-level tool-argument fields, in priority order, that identify the specific
 * resource a built-in tool acts on. The list deliberately spans BOTH taxonomies'
 * arg shapes: the hook input names a file `file_path` and the stream names it
 * `path`; both name a shell command `command`. Extracting the same resource
 * VALUE on both sides (the absolute path / the command string) is what lets the
 * hook-recorded denial token equal the stream-computed token. Authored here once
 * and injected into the generated preToolUse hook script so the runner and the
 * hook never disagree on which field to match.
 */
export const SALIENT_ARG_FIELDS = ["file_path", "path", "target_notebook", "command"] as const;

/**
 * Check whether a built-in (non-MCP) Cursor tool requires user approval.
 *
 * Resolved via {@link approvalCategory} so it answers correctly for BOTH
 * taxonomies — the hook's `Write`/`Shell`/`Delete` and the stream's
 * `edit`/`shell`/`delete` all return true. Only mutating/destructive tools are
 * gated; everything else (read-only built-ins, and — at the hook layer —
 * auto-approved MCP tools) is allowed. This "gate the dangerous set, allow the
 * rest" model mirrors the native harness's resolveToolApproval. It is
 * deliberately fail-OPEN for unknown tools: the merged MCP policy map carries
 * only the tools that REQUIRE approval, so a fail-closed default would wrongly
 * deny every auto-approved MCP tool, which the hook cannot distinguish from an
 * unknown built-in by name.
 */
export function builtInRequiresApproval(toolName: string): boolean {
  return approvalCategory(toolName) !== undefined;
}

/**
 * Returns the built-in tool names that require approval (the gated set the
 * preToolUse hook denies unless auto-approved or granted on reinvocation).
 *
 * These are HOOK-taxonomy names (PascalCase), because the hook matches its own
 * `tool_name`. See {@link approvalCategory} for the cross-layer identity.
 */
export function getBuiltInGatedList(): string[] {
  return [...BUILT_IN_GATED];
}

/**
 * Returns the gated built-in tools as `(hookToolName, category)` pairs.
 *
 * Injected into the generated preToolUse hook so the bash script can map its
 * incoming `tool_name` to the canonical category used for the denial/grant
 * token — the same category the runner computes from the stream side via
 * {@link approvalCategory}. Authoring it here keeps the mapping single-sourced;
 * a gated built-in with no category would be a programming error, so it is
 * filtered out (and would simply not be gated rather than crash the hook).
 */
export function getBuiltInGatedCategories(): Array<[string, ApprovalCategory]> {
  const pairs: Array<[string, ApprovalCategory]> = [];
  for (const name of BUILT_IN_GATED) {
    const category = approvalCategory(name);
    if (category) pairs.push([name, category]);
  }
  return pairs;
}

/**
 * Approval-message template for a gated built-in tool (either taxonomy), or
 * undefined when the tool is not gated. Resolved via {@link approvalCategory}
 * so stream-side names (`edit`/`shell`/`delete`) and hook-side names
 * (`Write`/`Shell`/`Delete`) both map to the same template. Callers resolve the
 * placeholders against the tool args via resolveApprovalMessage.
 */
export function getBuiltInApprovalMessage(toolName: string): string | undefined {
  const category = approvalCategory(toolName);
  return category ? CATEGORY_APPROVAL_MESSAGE[category] : undefined;
}

/**
 * Extract the canonical "salient" argument value that identifies the resource a
 * built-in tool acts on (the file path, the shell command, …). Returns "" when
 * no salient field is present. Kept in lockstep with SALIENT_ARG_FIELDS and the
 * generated hook script so grant matching at deny-time and reinvoke-time never
 * drift.
 */
export function extractArgKey(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  for (const field of SALIENT_ARG_FIELDS) {
    const v = args[field];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "";
}

