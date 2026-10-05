/**
 * The approval default — harness-agnostic.
 *
 * Stigmer asks before a shell command, a file write or delete, and an MCP
 * tool whose server marks it destructive (`DiscoveredTool.destructive_hint`,
 * recorded at connect from the tool's own MCP annotation). Nothing else asks
 * by default. An agent's hooks (`shared/hooks/`) answer before the default:
 * a hook that decides a call replaces the default for it, so a hook decides
 * which tools ask too. Two runtime layers then clear an approval that would
 * be asked:
 *  - Active approval leases, SCOPED: the pre-armed spec.auto_approve_all is a
 *    whole-run global bypass, while an interactive APPROVE_ALL ("approve all
 *    of this kind") grants a run-lifetime lease for only that action's scope
 *    (its built-in category, its MCP server, or one hook's asks on one tool).
 *    See {@link ActiveLeases}.
 *  - The unattended mode resolves an asked call as a skip.
 *
 * What a tool may be called at all is a separate question, the agent's tool
 * lists (`tool-lists.ts`), enforced ahead of this default on both engines.
 *
 * Used by both ExecuteCursor (hook-deny model) and ExecuteDeepAgent
 * (middleware interruptOn model) to determine which tools need approval.
 */

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApprovalAction, ApprovalMode, ApprovalPolicySource } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { SENSITIVE_ARG_KEYS } from "./args-preview.js";
import { toolApprovalCategory, type ToolApprovalCategory } from "./tool-kind.js";
import { extractFilePath } from "./file-tools.js";
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
  /**
   * Hook leases, by {@link hookLeaseKey}: a hook asked, the person chose
   * "approve all", and that hook's later asks on that tool count as its
   * allow. A category or server lease never clears a hook's ask.
   */
  readonly hooks: ReadonlySet<string>;
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
  | { readonly kind: "server"; readonly server: string }
  | { readonly kind: "hook"; readonly hook: string; readonly tool: string; readonly server: string };

/** The tool-call fields a lease scope is derived from. */
export interface LeaseScopeInput {
  readonly name: string;
  readonly mcpServerSlug: string;
  readonly approvalPolicySource: ApprovalPolicySource;
  readonly approvalPolicyHook: string;
}

/** The key a hook lease is held under: the hook (`""` for the agent's own block), the tool's server and its bound name. */
export function hookLeaseKey(hook: string, server: string, tool: string): string {
  return JSON.stringify([hook, server, tool]);
}

/**
 * Reduce a single tool call to the scope its APPROVE_ALL would lease — the core
 * of {@link deriveActiveLeases}, extracted so the cross-edition lease-scope
 * corpus (apis/testdata/hitl/lease-scope) can exercise it directly.
 *
 * A row a hook asked for (source HOOK) leases that hook's asks on that tool
 * and nothing else. Otherwise the MCP server slug takes precedence over the
 * built-in category and is used RAW (the server's identity, not
 * case-folded), matching the server's `deriveLeaseScope` byte for byte. The
 * category lookup reuses {@link toolApprovalCategory}, the shared oracle, so
 * a built-in resolves to write/delete/shell (read-only built-ins are ungated
 * and return `undefined`).
 */
export function deriveLeaseScope(row: LeaseScopeInput): LeaseScope | undefined {
  const { name: toolName, mcpServerSlug } = row;
  if (row.approvalPolicySource === ApprovalPolicySource.HOOK) {
    return { kind: "hook", hook: row.approvalPolicyHook, tool: toolName, server: mcpServerSlug };
  }
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
  const hooks = new Set<string>();

  const addLease = (tc: LeaseScopeInput & { approvalAction: ApprovalAction }): void => {
    if (tc.approvalAction !== ApprovalAction.APPROVE_ALL) return;
    const scope = deriveLeaseScope(tc);
    if (!scope) return;
    switch (scope.kind) {
      case "server":
        servers.add(scope.server);
        return;
      case "category":
        categories.add(scope.category);
        return;
      case "hook":
        hooks.add(hookLeaseKey(scope.hook, scope.server, scope.tool));
        return;
      /* v8 ignore start -- @preserve: the never arm; the compiler proves no scope kind reaches it */
      default: {
        const exhaustive: never = scope;
        throw new Error(`deriveActiveLeases: unknown lease scope ${JSON.stringify(exhaustive)}`);
      }
      /* v8 ignore stop */
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
    hooks,
  };
}

/**
 * Whether this execution runs in UNATTENDED approval mode
 * (`status.approval_mode`): the lane the turn came through — a schedule, a
 * messaging channel, a guest share — has no approver, so a gated tool is
 * resolved as an automatic skip (the model is told to adapt) instead of
 * pausing the execution for a decision that can never arrive.
 *
 * The mode is a fact of the lane, recorded by the control plane at create;
 * the request carries none, so a caller can never switch a turn's gates to
 * skipping. Anything but UNATTENDED (INTERACTIVE, and UNSPECIFIED on a record
 * written before the field existed) pauses for a decision: the safe default
 * is the one that asks.
 *
 * The mode changes HOW a gate resolves, never WHAT is gated: the default
 * below is identical in both modes. Both harnesses read the
 * mode through this one helper (the native gate skips instead of
 * interrupting; the Cursor hook records a non-pausing "unattended" denial),
 * so the surfaces can never diverge on what "unattended" means.
 */
export function isUnattendedApprovalMode(execution: AgentExecution): boolean {
  return execution.status?.approvalMode === ApprovalMode.UNATTENDED;
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
 */
export type PolicySource =
  | "auto_approve_all"               // pre-armed spec.auto_approve_all (whole-run global bypass)
  | "approval_lease"                 // a run-lifetime scoped lease cleared this action
  | "builtin_category"               // the default asked: a built-in of an approval category
  | "file_capture"                   // Capture mode: a git-tracked built-in file edit flows, reviewed post-hoc via the file_review ledger (not gated; audit-only on the shadow receipt)
  | "annotation_destructive_tighten" // the default asked: an MCP tool its server marks destructive
  | "unattended_skip"                // unattended approval mode auto-skipped this gated call (no approver on the creating surface)
  | "hook";                          // a hook decided this call: it refused it, asked first, or let it run

/**
 * Monotonic identifier of the policy-engine logic that produced a decision,
 * persisted on `ToolCall.policy_engine_version`. Bumped when the approval
 * semantics change so decisions made by different engine versions remain
 * distinguishable in audits. "default-1" was the first engine with no per-tool
 * policies: the default alone decided, from the tool's category or its
 * server's destructive annotation. "hooks-1" is the first in which an
 * agent's hooks answer before the default.
 */
export const POLICY_ENGINE_VERSION = "hooks-1";

/**
 * Map the runner-internal {@link PolicySource} to the persisted proto
 * {@link ApprovalPolicySource}. `undefined` (a call that needed no approval —
 * a read-only built-in, an MCP tool its server does not mark destructive)
 * maps to UNSPECIFIED, so the persisted field is left at its default exactly
 * as an unclassified `tool_kind` is. The 1:1 mapping keeps the runner's union
 * and the proto enum from drifting (asserted by the cross-edition corpus).
 */
export function toProtoPolicySource(source: PolicySource | undefined): ApprovalPolicySource {
  switch (source) {
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
    case "hook":
      return ApprovalPolicySource.HOOK;
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
 * The MCP half of the default for one turn: which MCP tools ask, and which
 * servers a lease has cleared. Built once per turn from the resolved servers
 * ({@link buildMcpApprovalDefault}) and read by the gate, the provenance
 * stamp and the Cursor hook state alike.
 */
export interface McpApprovalDefault {
  /** `${serverSlug}/${toolName}` for every tool its server marks destructive. */
  readonly destructive: ReadonlySet<string>;
  /** MCP server slugs with a run-lifetime lease (covers all of the server's tools). */
  readonly leasedServers: ReadonlySet<string>;
}

/** The key {@link McpApprovalDefault.destructive} is keyed by: server and tool, never the bare name. */
export function mcpToolKey(serverSlug: string, toolName: string): string {
  return `${serverSlug}/${toolName}`;
}

/** Build the turn's {@link McpApprovalDefault} from its resolved servers and leases. */
export function buildMcpApprovalDefault(
  resolvedServers: readonly ResolvedMcpServer[],
  leases: ActiveLeases,
): McpApprovalDefault {
  const destructive = new Set<string>();
  for (const server of resolvedServers) {
    for (const tool of server.destructiveTools) destructive.add(mcpToolKey(server.slug, tool));
  }
  return { destructive, leasedServers: leases.servers };
}

/**
 * Derive the authorization provenance — what decided this tool's approval —
 * for persisting on `ToolCall.approval_policy_source`.
 *
 * The read-side twin of {@link resolveToolApproval}: it answers for EVERY
 * tool (gated or not), so the StatusBuilders can stamp provenance on the
 * tool call exactly where they stamp `tool_kind`.
 *
 * Precedence:
 * 1. The whole-run global bypass (pre-armed auto_approve_all) governs
 *    everything — it is *why* anything ran ungated, so it wins.
 * 2. MCP tool: a leased server reads approval_lease; a destructive tool
 *    reads annotation_destructive_tighten; any other MCP tool needed no
 *    approval and reads `undefined`.
 * 3. Built-in: a mutating category is governed (leased → approval_lease, else
 *    builtin_category); a read-only built-in reads `undefined`.
 */
export function resolveApprovalProvenance(
  toolName: string,
  serverSlug: string,
  mcpDefault: McpApprovalDefault,
  leasedCategories: ReadonlySet<ToolApprovalCategory>,
  globalBypass: boolean,
): PolicySource | undefined {
  if (globalBypass) return "auto_approve_all";

  if (serverSlug) {
    if (mcpDefault.leasedServers.has(serverSlug)) return "approval_lease";
    if (mcpDefault.destructive.has(mcpToolKey(serverSlug, toolName))) return "annotation_destructive_tighten";
    return undefined;
  }

  const category = toolApprovalCategory(toolName);
  if (!category) return undefined;
  if (leasedCategories.has(category)) return "approval_lease";
  return "builtin_category";
}

/**
 * Resolve {{args.field}} placeholders in an approval message using the
 * tool's actual arguments.
 *
 * Placeholder syntax matches the proto-documented format:
 * - {{args.field_name}} — replaced with the argument value
 * - {{tool_name}} — replaced with the tool name
 * - Missing fields are replaced with "<unknown>"
 * - A secret-keyed field ({@link SENSITIVE_ARG_KEYS}) is replaced with
 *   "[REDACTED]" (stigmer#1119): the message is stored on the row and shown on
 *   the approval card, which must carry no more than the redacted preview.
 *   Every approval message in the runner, native and Cursor alike, resolves
 *   here, so this is the one place the rule applies to it.
 */
export function resolveApprovalMessage(
  template: string,
  toolName: string,
  args: Record<string, unknown>,
): string {
  return template
    .replace(/\{\{tool_name\}\}/g, toolName)
    .replace(/\{\{args\.(\w+)\}\}/g, (_match, field: string) => {
      if (SENSITIVE_ARG_KEYS.has(field.toLowerCase())) return "[REDACTED]";
      const value = args[field];
      if (value === undefined || value === null) return "<unknown>";
      if (typeof value === "string") return value;
      return JSON.stringify(value);
    });
}

// ── The gate's decision ─────────────────────────────────────────────

/**
 * THE approval-message template per mutating built-in category — the one
 * table both harnesses word their approval cards from (since #1097).
 * Keyed by category (not raw tool name) so every alias of a mutation renders
 * one message. It is read only through {@link resolveBuiltInApprovalMessage},
 * which the native gate (`resolveToolApproval`), the Cursor translator's `gate`
 * and the Cursor boundary's denied-call message all call, so the three can
 * never word a card differently.
 *
 * Until then the Cursor harness carried a table of its own and the two differed
 * by a word — `shell` read "Run command" there and "Execute command" here.
 * Unified on the plainer word: a user reads "Run command" and knows
 * what is being asked.
 */
export const CATEGORY_APPROVAL_MESSAGE: Record<ToolApprovalCategory, string> = {
  write: "Write file: {{args.path}}",
  delete: "Delete: {{args.path}}",
  shell: "Run command: {{args.command}}",
};

/**
 * THE approval-card message for a built-in tool of either harness taxonomy, or
 * `undefined` when the tool is not a gated built-in.
 *
 * The `{{args.path}}` a file card reads is filled from `extractFilePath`
 * (`file-tools.ts`), the one home of "which argument names the file" across
 * both taxonomies: deepagents' file tools and the Cursor hook send
 * `file_path`, the Cursor stream sends `path`. Resolving the raw args instead
 * rendered a gated native write as "Write file: <unknown>" (#1112). The
 * template keeps its one placeholder, so the table stays harness-neutral.
 */
export function resolveBuiltInApprovalMessage(
  toolName: string,
  args: Record<string, unknown>,
): string | undefined {
  const category = toolApprovalCategory(toolName);
  return category ? resolveCategoryApprovalMessage(category, toolName, args) : undefined;
}

function resolveCategoryApprovalMessage(
  category: ToolApprovalCategory,
  toolName: string,
  args: Record<string, unknown>,
): string {
  return resolveApprovalMessage(CATEGORY_APPROVAL_MESSAGE[category], toolName, categoryTemplateArgs(category, args));
}

/** The args a category's template resolves against: a file card reads the file from wherever its taxonomy names it. */
function categoryTemplateArgs(category: ToolApprovalCategory, args: Record<string, unknown>): Record<string, unknown> {
  switch (category) {
    case "write":
    case "delete": {
      const path = extractFilePath(args);
      return path === null ? args : { ...args, path };
    }
    case "shell":
      return args;
    default: {
      const exhaustive: never = category;
      throw new Error(`categoryTemplateArgs: unknown approval category ${String(exhaustive)}`);
    }
  }
}

/** What the gate decides for one call: whether it waits, the message the card shows, and what said so. */
export interface ApprovalRequirement {
  readonly requiresApproval: boolean;
  readonly message: string;
  /** What determined this verdict — stamped on the shadow receipt; `undefined` when no approval was needed. */
  readonly source: PolicySource | undefined;
}

/**
 * THE approval decision for one tool call — the function the native gate
 * (`middleware/approval-gate.ts`) interrupts on. A held call reaches the
 * transcript only through that interrupt (`approval_proposed`), so the row can
 * never disagree with the gate about whether a call waits (since #1097). Its
 * read-side twin is {@link resolveApprovalProvenance}.
 *
 * MCP tools: a leased server's tool passes as approval_lease; a tool its
 * server marks destructive asks, as annotation_destructive_tighten; every
 * other MCP tool passes. Only an explicit `destructiveHint: true` asks, so a
 * server that annotates nothing gates nothing — the server is the one that
 * knows what its tools do.
 *
 * Built-in/platform tools: gate exactly the mutating categories through the
 * shared tool taxonomy — fail-CLOSED for the mutating set (write/edit/delete/shell
 * require approval), fail-open for read-only and unclassified built-ins. A
 * run-lifetime category lease (the user chose "approve all <category>" earlier
 * in this run) auto-approves every built-in of that category for the rest of
 * the run — the scoped successor to auto-approve-all.
 */
export function resolveToolApproval(
  toolName: string,
  serverSlug: string,
  args: Record<string, unknown>,
  mcpDefault: McpApprovalDefault,
  leasedCategories: ReadonlySet<ToolApprovalCategory>,
): ApprovalRequirement {
  if (serverSlug) {
    if (mcpDefault.leasedServers.has(serverSlug)) {
      return { requiresApproval: false, message: "", source: "approval_lease" };
    }
    if (mcpDefault.destructive.has(mcpToolKey(serverSlug, toolName))) {
      return {
        requiresApproval: true,
        message: resolveApprovalMessage(DESTRUCTIVE_MCP_APPROVAL_MESSAGE, toolName, args),
        source: "annotation_destructive_tighten",
      };
    }
    return { requiresApproval: false, message: "", source: undefined };
  }

  const category = toolApprovalCategory(toolName);
  if (category) {
    if (leasedCategories.has(category)) {
      return { requiresApproval: false, message: "", source: "approval_lease" };
    }
    return {
      requiresApproval: true,
      message: resolveCategoryApprovalMessage(category, toolName, args),
      source: "builtin_category",
    };
  }

  return { requiresApproval: false, message: "", source: undefined };
}

/** The approval-card message for an MCP tool its server marks destructive. */
export const DESTRUCTIVE_MCP_APPROVAL_MESSAGE = "Execute {{tool_name}}";
