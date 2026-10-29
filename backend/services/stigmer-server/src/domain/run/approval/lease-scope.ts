/**
 * LeaseScope — the class of actions a
 * single APPROVE_ALL decision covers (the server edition of the runner's
 * ActiveLeases scope; see deriveActiveLeases in
 * backend/services/runner/src/shared/approval-policy.ts).
 *
 * An APPROVE_ALL ("approve all of this kind") is not an all-or-nothing
 * gate bypass: it grants a run-lifetime lease scoped to ONE class of
 * action. When a hook asked for the clicked call (its
 * stigmer.permission.asked event's policy_source is `hook`), the class is
 * that hook's asks on that tool: the deciding plugin's slug (the asked
 * event's policy_hook, empty for the agent's own hooks block), the tool's
 * name and its MCP server, if any. Otherwise it is the clicked tool's
 * built-in category (write/delete/shell) for a built-in, or its MCP server
 * for an MCP tool. Two asks belong to the same scope when their derived
 * scopes are equal (compare with sameLeaseScope — TS has no
 * comparable-struct ==), so a hook's lease never approves a call the
 * default asked for, and a default lease never approves a call a hook
 * asked for.
 *
 * The source decides: a hook slug on an ask whose source is not `hook` is
 * ignored. The derivation returns undefined when the tool has no scope (a
 * read-only built-in or an unknown name the default never asks for) —
 * callers treat that as matching nothing.
 *
 * What it reads is the ask as the session's log states it (`LeaseSubject`):
 * the agent.tool_use's name (or the agent.mcp_tool_use's name and
 * mcp_server_name) and its stigmer.permission.asked event's policy source
 * and hook; the source is the run's ApprovalPolicySource as one word
 * without its prefix. The shared corpus (apis/testdata/hitl/lease-scope)
 * pins this against the runner's twin; its vectors name the source by the
 * enum's name, and the corpus test reads each as its word.
 */
import { toolApprovalCategory } from "./tool-category.js";

/** The asked event's policy source word for an ask a hook decided. */
export const HOOK_POLICY_SOURCE = "hook";

/** An ask as a lease is derived from it (module header). */
export interface LeaseSubject {
  /** The tool's name. */
  readonly name: string;
  /** The MCP server the tool belongs to; empty for a built-in. */
  readonly mcpServer: string;
  /** Which rule asked, as the asked event's policy_source word; empty when none is recorded. */
  readonly policySource: string;
  /** The plugin whose hook asked; empty for the agent's own hooks. */
  readonly policyHook: string;
}

export interface LeaseScope {
  /** Built-in approval category (write/delete/shell); empty for MCP and hook scopes. */
  readonly category: string;
  /** MCP server slug; empty for a built-in. */
  readonly server: string;
  /**
   * The deciding hook's plugin slug, empty for the agent's own hooks block;
   * undefined for a scope the default derived.
   */
  readonly hook?: string;
  /** The tool's name; set only on a hook scope, which leases one tool. */
  readonly tool: string;
}

/**
 * Reduces an ask to the scope its "approve all" would lease. A hook's ask
 * leases that hook on that tool; otherwise the MCP server takes precedence
 * over the built-in category lookup, matching the runner's
 * deriveLeaseScope ordering byte-for-byte (a real built-in never carries a
 * server and a real MCP tool never resolves to a category, so the order is
 * parity insurance, not a behavioral choice). Returns undefined for a tool
 * with no leasable scope.
 */
export function deriveLeaseScope(ask: LeaseSubject): LeaseScope | undefined {
  const slug = ask.mcpServer;
  if (ask.policySource === HOOK_POLICY_SOURCE) {
    return {
      category: "",
      server: slug,
      hook: ask.policyHook,
      tool: ask.name,
    };
  }
  if (slug !== "") {
    return { category: "", server: slug, tool: "" };
  }
  const category = toolApprovalCategory(ask.name);
  if (category !== undefined) {
    return { category, server: "", tool: "" };
  }
  return undefined;
}

/** Value equality for lease scopes, field by field. */
export function sameLeaseScope(a: LeaseScope, b: LeaseScope): boolean {
  return (
    a.category === b.category &&
    a.server === b.server &&
    a.hook === b.hook &&
    a.tool === b.tool
  );
}
