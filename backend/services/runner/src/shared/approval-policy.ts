/**
 * Tool approval policy evaluation — harness-agnostic.
 *
 * Implements the four-level policy chain:
 * 1. McpServerStatus.tool_approvals — system-generated defaults
 * 2. McpServerSpec.pinned_tool_approvals — manual overrides
 * 3. McpServerUsage.tool_approval_overrides — per-agent customization
 * 4. AgentExecutionSpec.auto_approve_all — runtime bypass
 *
 * Used by both ExecuteCursor (hook-deny model) and ExecuteDeepAgent
 * (middleware interruptOn model) to determine which tools need approval.
 */

import type { ToolApprovalPolicy } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import type { ToolApprovalOverride } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ResolvedMcpServer } from "./mcp-resolver.js";

/**
 * Returns true if any tool call in the execution history (root or sub-agent)
 * carries an APPROVE_ALL decision.
 *
 * This is the runner-side realization of the APPROVE_ALL contract (see the
 * ApprovalAction doc in enum.proto): once a user has chosen "approve and don't
 * ask again" at any gate, the rest of THIS execution runs un-gated — exactly as
 * if spec.auto_approve_all were true. Both harnesses (native deepagents and
 * cursor) call this so the behavior is defined in exactly one place.
 */
export function hasApproveAllDecision(execution: AgentExecution): boolean {
  const status = execution.status;
  if (!status) return false;

  for (const message of status.messages) {
    for (const tc of message.toolCalls) {
      if (tc.approvalAction === ApprovalAction.APPROVE_ALL) return true;
    }
  }
  for (const sa of status.subAgentExecutions) {
    for (const message of sa.messages) {
      for (const tc of message.toolCalls) {
        if (tc.approvalAction === ApprovalAction.APPROVE_ALL) return true;
      }
    }
  }
  return false;
}

export interface MergedToolPolicy {
  toolName: string;
  mcpServerSlug: string;
  requiresApproval: boolean;
  approvalMessage: string;
}

/**
 * Merge approval policies from all four levels into a single lookup map.
 *
 * Keys are "serverSlug/toolName" to avoid collisions between servers.
 * When autoApproveAll is true, the returned map is empty.
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

    for (const policy of server.toolApprovals) {
      if (!policy.toolName) continue;
      serverPolicies.set(policy.toolName, {
        requiresApproval: true,
        message: policy.message || `Execute tool: ${policy.toolName}`,
      });
    }

    for (const pinned of server.pinnedToolApprovals) {
      if (!pinned.toolName) continue;
      serverPolicies.set(pinned.toolName, {
        requiresApproval: true,
        message: pinned.message || serverPolicies.get(pinned.toolName)?.message || `Execute tool: ${pinned.toolName}`,
      });
    }

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
