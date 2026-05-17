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
import type { ResolvedMcpServer } from "../adapter/mcp-resolver.js";

/**
 * A single tool's merged approval decision after evaluating all policy layers.
 */
export interface MergedToolPolicy {
  toolName: string;
  mcpServerSlug: string;
  requiresApproval: boolean;
  approvalMessage: string;
}

const BUILT_IN_REQUIRE_APPROVAL = new Set([
  "Shell",
  "Delete",
]);

const BUILT_IN_ALLOW = new Set([
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

/**
 * Check whether a built-in Cursor tool requires user approval.
 *
 * Built-in tools are not governed by MCP server policies — they use a
 * local allow-list maintained in the cursor-runner.
 */
export function builtInRequiresApproval(toolName: string): boolean {
  if (BUILT_IN_REQUIRE_APPROVAL.has(toolName)) return true;
  if (BUILT_IN_ALLOW.has(toolName)) return false;
  return true;
}

/**
 * Returns the set of built-in tool names that are always allowed.
 */
export function getBuiltInAllowList(): string[] {
  return [...BUILT_IN_ALLOW];
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
