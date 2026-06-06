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

import type { ToolApprovalPolicy } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import type { ToolApprovalOverride } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { ResolvedMcpServer } from "./mcp-resolver.js";

/**
 * A single tool's merged approval decision after evaluating all policy layers.
 */
export interface MergedToolPolicy {
  toolName: string;
  mcpServerSlug: string;
  requiresApproval: boolean;
  approvalMessage: string;
}

/**
 * Built-in (non-MCP) Cursor tools that mutate the workspace or execute
 * commands. These require approval when auto_approve_all is false, mirroring
 * the native harness's DANGEROUS_PLATFORM_TOOLS (write/edit/create/delete/
 * execute/shell). Each value is an approval-message template resolved against
 * the tool args (see resolveApprovalMessage); its placeholder names the same
 * field the grant matcher keys on (path/command/target_notebook).
 */
const BUILT_IN_GATED = new Map<string, string>([
  ["Write", "Write file: {{args.path}}"],
  ["StrReplace", "Edit file: {{args.path}}"],
  ["EditNotebook", "Edit notebook: {{args.target_notebook}}"],
  ["Shell", "Run command: {{args.command}}"],
  ["Delete", "Delete: {{args.path}}"],
]);

/**
 * Top-level tool-argument fields, in priority order, that identify the specific
 * resource a built-in tool acts on. Used to render approval messages and to key
 * HITL approval grants (see approval-state.ts). Authored here once and injected
 * into the generated preToolUse hook script so the runner and the hook always
 * agree on which field to match.
 */
export const SALIENT_ARG_FIELDS = ["path", "command", "target_notebook"] as const;

/**
 * Check whether a built-in (non-MCP) Cursor tool requires user approval.
 *
 * Only the explicitly gated, mutating/destructive tools require approval;
 * everything else (read-only built-ins, and — at the hook layer — auto-approved
 * MCP tools) is allowed. This "gate the dangerous set, allow the rest" model
 * mirrors the native harness's resolveToolApproval, which also defaults
 * unlisted tools to no-approval. It is deliberately fail-OPEN for unknown
 * tools: the merged MCP policy map carries only the tools that REQUIRE
 * approval, so a fail-closed default would wrongly deny every auto-approved
 * MCP tool, which the hook cannot distinguish from an unknown built-in by name.
 */
export function builtInRequiresApproval(toolName: string): boolean {
  return BUILT_IN_GATED.has(toolName);
}

/**
 * Returns the built-in tool names that require approval (the gated set the
 * preToolUse hook denies unless auto-approved or granted on reinvocation).
 */
export function getBuiltInGatedList(): string[] {
  return [...BUILT_IN_GATED.keys()];
}

/**
 * Approval-message template for a gated built-in tool, or undefined when the
 * tool is not a known gated built-in. Callers resolve the placeholders against
 * the tool args via resolveApprovalMessage.
 */
export function getBuiltInApprovalMessage(toolName: string): string | undefined {
  return BUILT_IN_GATED.get(toolName);
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

/**
 * Merge approval policies from all four levels into a single lookup map.
 *
 * Keys are the raw tool name (e.g., "apply_cloud_resource"). Each MCP server
 * contributes its own set of policies, so the map is keyed by
 * "serverSlug/toolName" to avoid collisions between servers.
 *
 * Policy chain (each level overrides the previous):
 * 1. status.toolApprovals — presence means "requires approval"
 * 2. spec.pinnedToolApprovals — presence means "requires approval" (overrides)
 * 3. agent tool_approval_overrides — explicit boolean per tool
 * 4. auto_approve_all — bypasses everything
 *
 * When auto_approve_all is true, the returned map is empty (no tool
 * requires approval).
 */
export function mergeApprovalPolicies(
  resolvedServers: ResolvedMcpServer[],
  agentOverrides: ToolApprovalOverride[],
  autoApproveAll: boolean,
): Map<string, MergedToolPolicy> {
  const merged = new Map<string, MergedToolPolicy>();

  if (autoApproveAll) return merged;

  for (const server of resolvedServers) {
    const serverPolicies = new Map<string, { requiresApproval: boolean; message: string }>();

    // Layer 1: system-generated defaults (presence = requires approval)
    for (const policy of server.toolApprovals) {
      if (!policy.toolName) continue;
      serverPolicies.set(policy.toolName, {
        requiresApproval: true,
        message: policy.message || `Execute tool: ${policy.toolName}`,
      });
    }

    // Layer 2: manual overrides (presence = requires approval, overrides layer 1)
    for (const pinned of server.pinnedToolApprovals) {
      if (!pinned.toolName) continue;
      serverPolicies.set(pinned.toolName, {
        requiresApproval: true,
        message: pinned.message || serverPolicies.get(pinned.toolName)?.message || `Execute tool: ${pinned.toolName}`,
      });
    }

    // Layer 3: per-agent overrides (explicit boolean, can enable or disable)
    for (const override of agentOverrides) {
      if (!override.toolName) continue;
      const existing = serverPolicies.get(override.toolName);
      if (existing) {
        existing.requiresApproval = override.requiresApproval;
        if (override.message) {
          existing.message = override.message;
        }
      } else if (override.requiresApproval) {
        serverPolicies.set(override.toolName, {
          requiresApproval: true,
          message: override.message || `Execute tool: ${override.toolName}`,
        });
      }
    }

    // Write merged policies into the result map
    for (const [toolName, policy] of serverPolicies) {
      if (!policy.requiresApproval) continue;
      const key = `${server.slug}/${toolName}`;
      merged.set(key, {
        toolName,
        mcpServerSlug: server.slug,
        requiresApproval: true,
        approvalMessage: policy.message,
      });
    }
  }

  return merged;
}

/**
 * Look up whether an MCP tool requires approval.
 *
 * @param toolName - The actual MCP tool name (e.g., "apply_cloud_resource")
 * @param mcpServerSlug - The MCP server slug (e.g., "planton")
 * @param policies - The merged policy map from mergeApprovalPolicies()
 * @returns The policy if approval is required, undefined if auto-approved
 */
export function lookupMcpToolPolicy(
  toolName: string,
  mcpServerSlug: string,
  policies: Map<string, MergedToolPolicy>,
): MergedToolPolicy | undefined {
  return policies.get(`${mcpServerSlug}/${toolName}`);
}

/**
 * Resolve {{args.field}} placeholders in an approval message using the
 * tool's actual arguments.
 *
 * Placeholder syntax matches the proto-documented format:
 * - {{args.field_name}} — replaced with the argument value
 * - {{tool_name}} — replaced with the tool name
 * - Missing fields are replaced with "<unknown>"
 */
export function resolveApprovalMessage(
  template: string,
  toolName: string,
  args: Record<string, unknown>,
): string {
  return template
    .replace(/\{\{tool_name\}\}/g, toolName)
    .replace(/\{\{args\.(\w+)\}\}/g, (_match, field: string) => {
      const value = args[field];
      if (value === undefined || value === null) return "<unknown>";
      if (typeof value === "string") return value;
      return JSON.stringify(value);
    });
}
