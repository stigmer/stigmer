/**
 * The approval default — harness-agnostic.
 *
 * Stigmer asks before a shell command and an MCP tool whose server marks it
 * destructive (`DiscoveredTool.destructive_hint`, recorded at connect from
 * the tool's own MCP annotation). A built-in file write or delete asks only
 * in a turn whose file review is on and whose workspace cannot capture it
 * (no git tree, no storage for CAS): with review off (the default; the
 * session's `file_review` switch) the edit simply flows, and with review on
 * a capturable edit flows and is offered for Keep or Undo after the turn
 * (`shared/filereview/capture.ts` `deriveCaptureMode`). Either way a
 * secret-like path the git substrate would not hold is refused outright
 * (`filereview/secret-paths.ts`). Nothing else asks by default. An agent's
 * hooks (`shared/hooks/`) answer before the default: a hook that decides a
 * call replaces the default for it, so a hook decides which tools ask too,
 * and an agent that wants "ask before every edit" writes a PreToolUse hook
 * that asks on a write. Two runtime layers then clear an approval that would
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
 * Used by both ExecuteDeepAgent (the approval-gate middleware) and
 * ExecuteClaude (the engine's `PreToolUse` gate) to determine which tools
 * need approval.
 */

import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { ApprovalMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SENSITIVE_ARG_KEYS } from "./args-preview.js";
import { toolApprovalCategory, type ToolApprovalCategory } from "./tool-kind.js";
import { extractFilePath } from "./file-tools.js";
import type { McpToolListing } from "./mcp-tool-listing.js";
import { ApprovalPolicySource } from "../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

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
 * Each lease is read from the session's log: the `stigmer.permission.grant` a
 * person's "approve all" wrote names its class (`StigmerPermissionLease`),
 * which the server derives from the call with {@link deriveLeaseScope}'s
 * rule. {@link deriveActiveLeases} builds the sets from the run's grants.
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
 * Reduce a single tool call to the scope its APPROVE_ALL would lease — the
 * rule the server's grant applies to name a lease (a grant's event carries
 * the result, which {@link deriveActiveLeases} reads), kept here so the
 * cross-edition lease-scope corpus (apis/testdata/hitl/lease-scope) proves
 * the runner's reading agrees with it.
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
 * The class of calls a grant allows, as its `stigmer.permission.grant`
 * states it (`StigmerPermissionLease`): a hook's asks on one tool (`hook`
 * set, `""` for the agent's own hooks), else an MCP server's tools
 * (`server` set), else a built-in category (`category`: write, delete or
 * shell). The server derives it from the call it was given on with the
 * same rule as {@link deriveLeaseScope}.
 */
export interface LeaseGrant {
  readonly category: string;
  readonly server: string;
  readonly hook: string | undefined;
  readonly tool: string;
}

const LEASABLE_CATEGORIES: ReadonlySet<string> = new Set<ToolApprovalCategory>(["write", "delete", "shell"]);

/**
 * Derive the active approval leases for a turn from the run's grants.
 *
 * The scoped successor to the former all-or-nothing hasApproveAllDecision:
 * instead of "any APPROVE_ALL anywhere disables the whole gate", each grant
 * a person gave ("approve all") leases only the class its event names: one
 * hook's asks on one tool, an MCP server's tools, or a built-in category
 * (read-only tools are never gated, so a built-in lease is always
 * write/delete/shell). A category word the runner does not know leases
 * nothing.
 *
 * The grants are the run's, read from the session's log at the
 * reinvocation (`harness/approval-answers.ts`), so a lease granted on any
 * call, root or sub-agent, applies run-wide (bounded by its scope); a fresh
 * turn has none. Both harnesses take the result through the runtime, so the
 * contract is defined in exactly one place. `autoApproveAll` is the run's
 * pre-armed `spec.auto_approve_all`, the one unscoped bypass.
 */
export function deriveActiveLeases(grants: Iterable<LeaseGrant>, autoApproveAll: boolean): ActiveLeases {
  const categories = new Set<ToolApprovalCategory>();
  const servers = new Set<string>();
  const hooks = new Set<string>();
  for (const grant of grants) {
    if (grant.hook !== undefined) hooks.add(hookLeaseKey(grant.hook, grant.server, grant.tool));
    else if (grant.server !== "") servers.add(grant.server);
    else if (LEASABLE_CATEGORIES.has(grant.category)) categories.add(grant.category as ToolApprovalCategory);
  }
  return { global: autoApproveAll, categories, servers, hooks };
}

/**
 * Whether this execution runs in UNATTENDED approval mode
 * (`status.approval_mode`): the lane the turn came through — a schedule, a
 * Slack or WhatsApp channel, a chat link's guest — has no approver, so a gated tool is
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
 * mode through this one helper (each gate skips instead of pausing), so the
 * surfaces can never diverge on what "unattended" means.
 */
export function isUnattendedApprovalMode(execution: Run): boolean {
  return execution.status?.approvalMode === ApprovalMode.UNATTENDED;
}

/**
 * The tool-result text for an unattended auto-skip — ONE definition for both
 * harnesses (each gate returns it as the skipped call's result), so the
 * transcript
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
  | "file_review_off"                // File review is off for the turn: a built-in file edit flows and is not reviewed (not gated; audit-only on the shadow receipt)
  | "outputs"                        // A built-in write or delete inside the outputs folder flows where a workspace edit would flow unasked, and is not reviewed: it comes back as a File (not gated; audit-only on the shadow receipt)
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
 * agent's hooks answer before the default. "hooks-2" is the first in which a
 * built-in file write or delete flows unasked when the turn's file review is
 * off (stigmer#1471). "hooks-3" is the first in which a built-in write or
 * delete inside the outputs folder (`.stigmer/outputs/`) flows unasked and
 * unreviewed wherever a workspace edit would flow unasked.
 */
export const POLICY_ENGINE_VERSION = "hooks-3";

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
    case "file_review_off":
    case "outputs":
      // A flowing file edit is never persisted on a gated tool call (the file
      // tool is not gated — it has no WAITING_APPROVAL row); its source exists
      // only on the audit receipt. Map to UNSPECIFIED for the proto-persisted field.
      return ApprovalPolicySource.UNSPECIFIED;
    case undefined:
      return ApprovalPolicySource.UNSPECIFIED;
  }
}

/**
 * The MCP half of the default for one turn: which MCP tools ask, and which
 * servers a lease has cleared. Built by the engine that binds the tools,
 * from the marks it read live ({@link buildMcpApprovalDefault}): the Stigmer
 * harness from the tools it loads, the Claude engine from the tools the
 * host's bridge loads. Read by the gate and the provenance stamp alike.
 */
export interface McpApprovalDefault {
  /** `${serverSlug}/${toolName}` for every tool its server marks destructive. */
  readonly destructive: ReadonlySet<string>;
  /**
   * Plugin servers whose tools could not be listed this turn: every one of
   * their tools asks, since an unread mark never means "ask nothing".
   */
  readonly unlisted: ReadonlySet<string>;
  /** MCP server slugs with a run-lifetime lease (covers all of the server's tools). */
  readonly leasedServers: ReadonlySet<string>;
}

/** The key {@link McpApprovalDefault.destructive} is keyed by: server and tool, never the bare name. */
export function mcpToolKey(serverSlug: string, toolName: string): string {
  return `${serverSlug}/${toolName}`;
}

/** Build the turn's {@link McpApprovalDefault} from what its servers listed and its leases. */
export function buildMcpApprovalDefault(
  listing: McpToolListing,
  leases: ActiveLeases,
): McpApprovalDefault {
  return {
    destructive: new Set(listing.destructive.map(({ server, tool }) => mcpToolKey(server, tool))),
    unlisted: new Set(listing.unlisted),
    leasedServers: leases.servers,
  };
}

/** Nothing listed yet: the leases alone, before an engine reads its tools' marks. */
export const NOTHING_LISTED: McpToolListing = { listed: [], destructive: [], unlisted: [], offered: [] };

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
    if (mcpDefault.unlisted.has(serverSlug)) return "annotation_destructive_tighten";
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
 *   Every approval message in the runner, Stigmer and Claude alike, resolves
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
 * which every gate calls, so no two can word a card differently. `shell`
 * reads "Run command", the plainer word: a user reads it and knows what is
 * being asked.
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
 * both taxonomies: deepagents' and Claude's file tools send `file_path`;
 * `path` is read too. Resolving the raw args instead
 * rendered a gated Stigmer-harness write as "Write file: <unknown>" (#1112). The
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
 * THE approval decision for one tool call — the function the Stigmer harness's gate
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
    if (mcpDefault.unlisted.has(serverSlug)) {
      return {
        requiresApproval: true,
        message: resolveApprovalMessage(UNLISTED_MCP_APPROVAL_MESSAGE, toolName, args),
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

/** The question for a tool of a server whose tools could not be listed, so whether it is destructive is unknown. */
export const UNLISTED_MCP_APPROVAL_MESSAGE =
  "Execute {{tool_name}} (its server's tools could not be listed this turn, so whether it changes anything is unknown)";
