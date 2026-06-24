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

/**
 * Provenance of a gate decision: which policy layer (or decision point) is
 * responsible for the final requires-approval verdict. Stamped on the shadow
 * ExecutionReceipt for audit, mirroring the Phase 1/2 shadow-log discipline —
 * no proto, no persistence.
 *
 * Note on `annotation_destructive_tighten`: the connect-time destructiveHint
 * tightener (see applyDestructiveHintTightener) writes its result INTO
 * `McpServerStatus.tool_approvals`, so at policy-merge time it is indistinguishable
 * from any other classifier default and correctly surfaces as `classifier_default`.
 * Carrying it as a distinct, persisted provenance needs a proto field and is
 * deferred to Phase 7; it is intentionally absent from this union to avoid
 * claiming a distinction the merge cannot faithfully make.
 */
export type PolicySource =
  | "classifier_default" // Layer 1: McpServerStatus.tool_approvals (connect-time classifier)
  | "pinned_override"    // Layer 2: McpServerSpec.pinned_tool_approvals
  | "agent_override"     // Layer 3: Agent McpServerUsage.tool_approval_overrides
  | "auto_approve_all"   // Layer 4 / APPROVE_ALL: whole gate bypassed upstream
  | "builtin_category";  // Non-MCP built-in gated by the shared tool taxonomy

/**
 * Monotonic identifier of the policy-engine logic that produced a decision.
 * Bumped when the merge/classification semantics change so receipts emitted by
 * different engine versions remain distinguishable in logs. Shadow-only.
 */
export const POLICY_ENGINE_VERSION = "phase-6";

/**
 * A single MCP tool's merged approval decision after evaluating all policy
 * layers. This is the single, canonical shape shared by every harness; the
 * Cursor harness re-exports it from here so the two harnesses can never drift.
 */
export interface MergedToolPolicy {
  toolName: string;
  mcpServerSlug: string;
  requiresApproval: boolean;
  approvalMessage: string;
  /** Which policy layer set this verdict (provenance for the shadow receipt). */
  source: PolicySource;
}

/**
 * Merge approval policies from all four levels into a single lookup map.
 *
 * Each MCP server contributes its own set of policies, so the map is keyed by
 * "serverSlug/toolName" to avoid collisions between servers.
 *
 * Policy chain (each level overrides the previous):
 * 1. status.toolApprovals — system-generated defaults; presence = requires approval
 * 2. spec.pinnedToolApprovals — manual overrides; presence = requires approval
 * 3. agent tool_approval_overrides — explicit boolean per tool (enable OR disable)
 * 4. auto_approve_all — runtime bypass (highest priority)
 *
 * When auto_approve_all is true, the returned map is empty (no tool requires
 * approval). The map carries ONLY the tools that require approval — a tool's
 * absence means "auto-approved".
 *
 * Used by both ExecuteCursor (hook-deny model) and ExecuteDeepAgent (middleware
 * interruptOn model), so the four-level semantics are defined in exactly one
 * place.
 */
export function mergeApprovalPolicies(
  resolvedServers: ResolvedMcpServer[],
  agentOverrides: ToolApprovalOverride[],
  autoApproveAll: boolean,
): Map<string, MergedToolPolicy> {
  const merged = new Map<string, MergedToolPolicy>();

  if (autoApproveAll) return merged;

  for (const server of resolvedServers) {
    const serverPolicies = new Map<string, { requiresApproval: boolean; message: string; source: PolicySource }>();

    // Layer 1: system-generated defaults (presence = requires approval).
    for (const policy of server.toolApprovals) {
      if (!policy.toolName) continue;
      serverPolicies.set(policy.toolName, {
        requiresApproval: true,
        message: policy.message || `Execute tool: ${policy.toolName}`,
        source: "classifier_default",
      });
    }

    // Layer 2: manual overrides (presence = requires approval, overrides layer 1).
    for (const pinned of server.pinnedToolApprovals) {
      if (!pinned.toolName) continue;
      serverPolicies.set(pinned.toolName, {
        requiresApproval: true,
        message: pinned.message || serverPolicies.get(pinned.toolName)?.message || `Execute tool: ${pinned.toolName}`,
        source: "pinned_override",
      });
    }

    // Layer 3: per-agent overrides (explicit boolean, can enable or disable).
    // Touching a tool here makes the per-agent layer the responsible source,
    // whether it enables, disables, or re-messages the gate.
    for (const override of agentOverrides) {
      if (!override.toolName) continue;
      const existing = serverPolicies.get(override.toolName);
      if (existing) {
        existing.requiresApproval = override.requiresApproval;
        existing.source = "agent_override";
        if (override.message) {
          existing.message = override.message;
        }
      } else if (override.requiresApproval) {
        serverPolicies.set(override.toolName, {
          requiresApproval: true,
          message: override.message || `Execute tool: ${override.toolName}`,
          source: "agent_override",
        });
      }
    }

    // Emit only the tools that still require approval after all layers.
    for (const [toolName, policy] of serverPolicies) {
      if (!policy.requiresApproval) continue;
      const key = `${server.slug}/${toolName}`;
      merged.set(key, {
        toolName,
        mcpServerSlug: server.slug,
        requiresApproval: true,
        approvalMessage: policy.message,
        source: policy.source,
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
 * @param policies - The merged policy map from {@link mergeApprovalPolicies}
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
