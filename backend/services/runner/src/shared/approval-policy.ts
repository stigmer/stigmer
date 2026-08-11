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
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApprovalAction, ApprovalMode, ApprovalPolicySource } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
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
 * Whether this execution runs in UNATTENDED approval mode
 * (ExecutionConfig.approval_mode): the creating surface — a messaging
 * channel, a guest share — has no approver, so a gated tool is resolved as
 * an automatic skip (the model is told to adapt) instead of pausing the
 * execution for a decision that can never arrive.
 *
 * The mode changes HOW a gate resolves, never WHAT is gated: the four-level
 * policy merge below is identical in both modes. Both harnesses read the
 * mode through this one helper (the native gate skips instead of
 * interrupting; the Cursor hook records a non-pausing "unattended" denial),
 * so the surfaces can never diverge on what "unattended" means.
 */
export function isUnattendedApprovalMode(execution: AgentExecution): boolean {
  return execution.spec?.executionConfig?.approvalMode === ApprovalMode.UNATTENDED;
}

/**
 * The tool-result text for an unattended auto-skip — ONE definition for both
 * harnesses (the native gate returns it as the skip ToolMessage; the Cursor
 * turn boundary backfills it onto stamped SKIPPED rows), so the transcript
 * reads identically wherever the skip happened. Deliberately instructs
 * plain-language adaptation with NO tool/approval vocabulary reaching the end
 * user (the channel/guest anti-leak posture).
 */
export function unattendedSkipMessage(toolName: string): string {
  return (
    `Tool '${toolName}' requires an approval that is not available in ` +
    `this conversation, so it was skipped automatically. Do not retry ` +
    `it or attempt a workaround. Adapt your plan, and explain to the ` +
    `user in plain language what you could not do and what they can ` +
    `do instead — never mention tools, approvals, or platform ` +
    `mechanics.`
  );
}

/**
 * Provenance of a gate decision: which policy layer (or decision point) is
 * responsible for the final requires-approval verdict.
 *
 * Mirrors the proto {@link ApprovalPolicySource} one for one (see
 * {@link toProtoPolicySource}); persisted on `ToolCall.approval_policy_source`
 * so every authorization is auditable, and still stamped on the shadow
 * ExecutionReceipt as a defense-in-depth audit signal.
 *
 * `annotation_destructive_tighten` is first-class: the connect-time tightener
 * (see applyDestructiveHintTightener) marks its force-gated entries with
 * `ToolApprovalPolicy.from_destructive_hint`, which {@link mergeApprovalPolicies}
 * reads to attribute the gate to the annotation rather than collapsing it into
 * the classifier default.
 */
export type PolicySource =
  | "classifier_default"             // Layer 1: McpServerStatus.tool_approvals (connect-time classifier)
  | "pinned_override"                // Layer 2: McpServerSpec.pinned_tool_approvals
  | "agent_override"                 // Layer 3: Agent McpServerUsage.tool_approval_overrides
  | "auto_approve_all"               // Layer 4: pre-armed spec.auto_approve_all (whole-run global bypass)
  | "approval_lease"                 // Layer 4: a run-lifetime scoped lease cleared this action
  | "builtin_category"               // Non-MCP built-in gated by the shared tool taxonomy
  | "file_capture"                   // Capture mode: a git-tracked built-in file edit flows, reviewed post-hoc via the file_review ledger (not gated; audit-only on the shadow receipt)
  | "annotation_destructive_tighten" // Layer 1 sub-case: connect-time destructiveHint tightener force-gated this MCP tool
  | "unattended_skip";               // Layer 4 resolution: unattended approval mode auto-skipped this gated call (no approver on the creating surface)

/**
 * Monotonic identifier of the policy-engine logic that produced a decision,
 * persisted on `ToolCall.policy_engine_version`. Bumped when the
 * merge/classification semantics change so decisions made by different engine
 * versions remain distinguishable in audits. Phase 7 made
 * `annotation_destructive_tighten` a distinct, persisted source.
 */
export const POLICY_ENGINE_VERSION = "phase-7";

/**
 * Map the runner-internal {@link PolicySource} to the persisted proto
 * {@link ApprovalPolicySource}. `undefined` (a tool no policy layer governs —
 * e.g. a read-only built-in) maps to UNSPECIFIED, so the persisted field is left
 * at its default exactly as an unclassified `tool_kind` is. The 1:1 mapping keeps
 * the runner's union and the proto enum from drifting (asserted by the
 * cross-edition corpus).
 */
export function toProtoPolicySource(source: PolicySource | undefined): ApprovalPolicySource {
  switch (source) {
    case "classifier_default":
      return ApprovalPolicySource.CLASSIFIER_DEFAULT;
    case "pinned_override":
      return ApprovalPolicySource.PINNED_OVERRIDE;
    case "agent_override":
      return ApprovalPolicySource.AGENT_OVERRIDE;
    case "auto_approve_all":
      return ApprovalPolicySource.AUTO_APPROVE_ALL;
    case "approval_lease":
      return ApprovalPolicySource.APPROVAL_LEASE;
    case "builtin_category":
      return ApprovalPolicySource.BUILTIN_CATEGORY;
    case "annotation_destructive_tighten":
      return ApprovalPolicySource.ANNOTATION_DESTRUCTIVE_TIGHTEN;
    case "unattended_skip":
      return ApprovalPolicySource.UNATTENDED_SKIP;
    case "file_capture":
      // Capture-mode flow is never persisted on a gated tool call (the file tool
      // is not gated — it has no WAITING_APPROVAL row); it exists only on the
      // audit receipt. Map to UNSPECIFIED for the proto-persisted field.
      return ApprovalPolicySource.UNSPECIFIED;
    case undefined:
      return ApprovalPolicySource.UNSPECIFIED;
  }
}

/**
 * Derive the authorization provenance — which policy layer governs this tool —
 * for persisting on `ToolCall.approval_policy_source`.
 *
 * This is the read-side twin of the gate's decision logic: same layered
 * precedence, but it answers "which layer governs this call?" for EVERY tool
 * (gated or auto-approved), so the StatusBuilders can stamp provenance on the
 * tool call exactly where they stamp `tool_kind`. It returns `undefined` for a
 * plain read-only built-in that no policy layer touches (the proto's
 * APPROVAL_POLICY_SOURCE_UNSPECIFIED).
 *
 * Precedence:
 * 1. Whole-run global bypass (pre-armed auto_approve_all) governs everything —
 *    it is *why* anything ran ungated, so it wins.
 * 2. MCP tool: the merged policy carries the responsible layer when gated; an
 *    absent entry means the four-level chain cleared it (classifier base). A
 *    server-scoped lease also surfaces as an absent entry — distinguishing it
 *    would need the lease set threaded here and is deferred with the rest of the
 *    per-server lease provenance, so a lease-cleared MCP tool reads
 *    classifier_default (matching the gate).
 * 3. Built-in: a mutating category is governed (leased → approval_lease, else
 *    builtin_category); a read-only built-in is governed by no layer → undefined.
 */
export function resolveApprovalProvenance(
  toolName: string,
  serverSlug: string,
  policies: ReadonlyMap<string, MergedToolPolicy>,
  leasedCategories: ReadonlySet<ToolApprovalCategory>,
  globalBypass: boolean,
): PolicySource | undefined {
  if (globalBypass) return "auto_approve_all";

  if (serverSlug) {
    const policy = policies.get(`${serverSlug}/${toolName}`);
    if (policy) return policy.source;
    return "classifier_default";
  }

  const category = toolApprovalCategory(toolName);
  if (!category) return undefined;
  if (leasedCategories.has(category)) return "approval_lease";
  return "builtin_category";
}

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
 * 3. usage tool_approval_overrides — explicit boolean per tool (enable OR disable)
 * 4. active leases — runtime bypass (highest priority), now scoped
 *
 * Layer 3 is read from {@link ResolvedMcpServer.toolApprovalOverrides} — the
 * overrides ride each server from the usage that resolved it (issue #349), so
 * an override is STRUCTURALLY scoped to its own server. There is deliberately
 * no cross-server override input: a flat list applied inside this per-server
 * loop is how an override once leaked onto — or silently un-gated — a
 * same-named tool on another server.
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

    // Layer 1: system-generated defaults (presence = requires approval). A tool
    // the connect-time tightener force-gated from its destructiveHint annotation
    // carries that provenance (from_destructive_hint) so it is attributed to the
    // annotation rather than the classifier — the only sub-case within layer 1.
    for (const policy of server.toolApprovals) {
      if (!policy.toolName) continue;
      serverPolicies.set(policy.toolName, {
        requiresApproval: true,
        message: policy.message || `Execute tool: ${policy.toolName}`,
        source: policy.fromDestructiveHint
          ? "annotation_destructive_tighten"
          : "classifier_default",
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

    // Layer 3: this usage's overrides (explicit boolean, can enable or
    // disable) — scoped to THIS server because they arrived on it (see the
    // function doc). Touching a tool here makes the per-agent layer the
    // responsible source, whether it enables, disables, or re-messages the
    // gate.
    for (const override of server.toolApprovalOverrides) {
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
