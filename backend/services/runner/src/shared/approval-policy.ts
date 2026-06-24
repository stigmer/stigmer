/**
 * Tool approval policy evaluation — harness-agnostic.
 *
 * Implements the four-level policy chain:
 * 1. McpServerStatus.tool_approvals — system-generated defaults
 * 2. McpServerSpec.pinned_tool_approvals — manual overrides
 * 3. McpServerUsage.tool_approval_overrides — per-agent customization
 * 4. Active approval leases — the runtime bypass, now SCOPED: the pre-armed
 *    spec.auto_approve_all is a whole-run global bypass, while an interactive
 *    APPROVE_ALL ("approve all of this kind") grants a run-lifetime lease for
 *    only that action's scope (its built-in category, or its MCP server). See
 *    {@link ActiveLeases}.
 *
 * Used by both ExecuteCursor (hook-deny model) and ExecuteDeepAgent
 * (middleware interruptOn model) to determine which tools need approval.
 */

import type { ToolApprovalPolicy } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import type { ToolApprovalOverride } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { toolApprovalCategory, type ToolApprovalCategory } from "./tool-kind.js";
import type { ResolvedMcpServer } from "./mcp-resolver.js";

/**
 * The set of run-lifetime approval leases active for an execution.
 *
 * A lease is the scoped successor to the old all-or-nothing "approve all". When
 * a user chooses APPROVE_ALL ("approve and don't ask again") at a gate it no
 * longer disables the entire gate — it grants a lease for ONLY that action's
 * scope, for the remainder of THIS execution: a mutating built-in category
 * ({@link ToolApprovalCategory}) for a built-in tool, or an MCP server slug for
 * an MCP tool. A different class of action proposed later is still gated.
 *
 * This is the DERIVED form of the lease — it is not (yet) a persisted proto.
 * Each lease rides the `ToolCall.approval_action == APPROVE_ALL` decision that
 * is already persisted and preserved (Go PreserveApprovalFields / Java
 * ApprovalFieldPreserver), and its scope is recomputed on read from the tool's
 * name + mcp_server_slug. Keeping it derived means one source of truth with
 * nothing to drift; a persisted/transmitted `ApprovalLease` proto is warranted
 * only once a lease must cross a trust boundary (a later phase).
 *
 * `global` is the one remaining UNSCOPED bypass: the deliberate, pre-armed
 * spec.auto_approve_all ("trust this whole run", set before the run via
 * CLI/API/CI). It is intentionally distinct from the interactive scoped leases.
 */
export interface ActiveLeases {
  /** Pre-armed spec.auto_approve_all: the whole gate is inert for the run. */
  readonly global: boolean;
  /** Built-in approval categories with a run-lifetime lease. */
  readonly categories: ReadonlySet<ToolApprovalCategory>;
  /** MCP server slugs with a run-lifetime lease (covers all of the server's tools). */
  readonly servers: ReadonlySet<string>;
}

/**
 * The class an APPROVE_ALL leases for a single tool call: an MCP tool leases its
 * whole `server`, a gated built-in leases its `category`. `undefined` means the
 * tool has no leasable scope (a read-only built-in, an unknown name).
 *
 * A discriminated union (not a `{ category?, server? }` bag) so callers cannot
 * construct or observe the impossible "both set" / "neither set" states.
 */
export type LeaseScope =
  | { readonly kind: "category"; readonly category: ToolApprovalCategory }
  | { readonly kind: "server"; readonly server: string };

/**
 * Reduce a single tool call to the scope its APPROVE_ALL would lease — the core
 * of {@link deriveActiveLeases}, extracted so the cross-edition lease-scope
 * corpus (apis/testdata/hitl/lease-scope) can exercise it directly.
 *
 * The MCP server slug takes precedence over the built-in category and is used
 * RAW (the server's identity, not case-folded), matching the Go
 * {@link DeriveLeaseScope} and Java {@link LeaseScope.deriveKey} byte-for-byte.
 * The category lookup reuses {@link toolApprovalCategory}, the shared oracle, so
 * a built-in resolves to write/delete/shell (read-only built-ins are ungated and
 * return `undefined`).
 */
export function deriveLeaseScope(
  toolName: string,
  mcpServerSlug: string,
): LeaseScope | undefined {
  if (mcpServerSlug) {
    return { kind: "server", server: mcpServerSlug };
  }
  const category = toolApprovalCategory(toolName);
  if (category) {
    return { kind: "category", category };
  }
  return undefined;
}

/**
 * Derive the active approval leases for an execution.
 *
 * The scoped successor to the former all-or-nothing hasApproveAllDecision:
 * instead of "any APPROVE_ALL anywhere disables the whole gate", each
 * APPROVE_ALL decision is reduced (via {@link deriveLeaseScope}) to the SCOPE of
 * the tool it was made on — the built-in category for a built-in tool (read-only
 * tools are never gated, so a built-in lease is always write/delete/shell), or
 * the MCP server slug for an MCP tool — and only that scope is auto-approved for
 * the rest of the run.
 *
 * Scans root and sub-agent tool calls so a lease granted anywhere applies
 * execution-wide (matching the prior cross-sub-agent behavior, now bounded by
 * scope). Both harnesses call this so the contract is defined in exactly one
 * place. The scope derivation reuses {@link toolApprovalCategory}, the same
 * corpus-tested oracle the Go and Java editions mirror, so the backend's
 * scope-aware bulk-approve and this runner-side evaluation can never disagree.
 */
export function deriveActiveLeases(execution: AgentExecution): ActiveLeases {
  const categories = new Set<ToolApprovalCategory>();
  const servers = new Set<string>();

  const addLease = (tc: {
    approvalAction: ApprovalAction;
    mcpServerSlug: string;
    name: string;
  }): void => {
    if (tc.approvalAction !== ApprovalAction.APPROVE_ALL) return;
    const scope = deriveLeaseScope(tc.name, tc.mcpServerSlug);
    if (!scope) return;
    if (scope.kind === "server") {
      servers.add(scope.server);
    } else {
      categories.add(scope.category);
    }
  };

  const status = execution.status;
  if (status) {
    for (const message of status.messages) {
      for (const tc of message.toolCalls) addLease(tc);
    }
    for (const sa of status.subAgentExecutions) {
      for (const message of sa.messages) {
        for (const tc of message.toolCalls) addLease(tc);
      }
    }
  }

  return {
    global: execution.spec?.autoApproveAll ?? false,
    categories,
    servers,
  };
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
  | "auto_approve_all"   // Layer 4: pre-armed spec.auto_approve_all (whole-run global bypass)
  | "approval_lease"     // Layer 4: a run-lifetime scoped lease cleared this action
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
 * 4. active leases — runtime bypass (highest priority), now scoped
 *
 * The map carries ONLY the tools that require approval — a tool's absence means
 * "auto-approved". Leases shape that absence:
 * - On a global pre-arm ({@link ActiveLeases.global}) the map is empty.
 * - A server-scoped lease drops that server's tools from the map entirely. This
 *   single omission makes EVERY substrate treat the server as auto-approved with
 *   no extra code — the deep-agent gate and StatusBuilder read the map, and the
 *   Cursor hook's mcpToolPolicies is built from it (the hook is not itself
 *   server-aware, so omission is the only way to lease an MCP server there).
 * Built-in CATEGORY leases are NOT applied here — built-ins are not in this map;
 * they are cleared at the gate (deep-agent) and the hook (Cursor) instead.
 *
 * Used by both ExecuteCursor (hook-deny model) and ExecuteDeepAgent (middleware
 * interruptOn model), so the four-level semantics are defined in exactly one
 * place.
 */
export function mergeApprovalPolicies(
  resolvedServers: ResolvedMcpServer[],
  agentOverrides: ToolApprovalOverride[],
  leases: ActiveLeases,
): Map<string, MergedToolPolicy> {
  const merged = new Map<string, MergedToolPolicy>();

  if (leases.global) return merged;

  for (const server of resolvedServers) {
    // Server-scoped lease: a prior APPROVE_ALL on one of this server's tools
    // auto-approves the whole server for the run, so none of its tools enter the
    // require-approval map (identical to how an already-auto-approved tool is
    // absent — every consumer treats it as cleared).
    if (leases.servers.has(server.slug)) continue;

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
