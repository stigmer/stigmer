/**
 * LeaseScope — ports approval/lease_scope.go: the class of actions a
 * single APPROVE_ALL decision covers (the server edition of the runner's
 * ActiveLeases scope; see deriveActiveLeases in
 * backend/services/runner/src/shared/approval-policy.ts).
 *
 * An APPROVE_ALL ("approve all of this kind") is not an all-or-nothing
 * gate bypass: it grants a run-lifetime lease scoped to ONE class of
 * action. When a hook asked for the clicked call (its
 * approval_policy_source is HOOK), the class is that hook's asks on that
 * tool: the deciding plugin's slug (approval_policy_hook, empty for the
 * agent's own hooks block), the tool's name and its MCP server, if any.
 * Otherwise it is the clicked tool's built-in category (write/delete/
 * shell) for a built-in, or its MCP server for an MCP tool. Two tool calls
 * belong to the same scope when their derived scopes are equal (compare
 * with sameLeaseScope — TS has no comparable-struct ==), so a hook's lease
 * never approves a call the default asked for, and a default lease never
 * approves a call a hook asked for.
 *
 * The source decides: a hook slug on a row whose source is not HOOK is
 * ignored. The derivation returns undefined when the tool has no scope (a
 * read-only built-in or an unknown name the default never asks for) —
 * callers treat that as matching nothing. The shared corpus
 * (apis/testdata/hitl/lease-scope) pins this against the runner's twin.
 */
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ApprovalPolicySource } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { toolApprovalCategory } from "./tool-category.js";

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
 * Reduces a tool call to the scope its APPROVE_ALL would lease. A hook's
 * ask leases that hook on that tool; otherwise the MCP server slug takes
 * precedence over the built-in category lookup, matching the runner's
 * deriveLeaseScope ordering byte-for-byte (a real built-in never carries a
 * server slug and a real MCP tool never resolves to a category, so the
 * order is parity insurance, not a behavioral choice). Returns undefined
 * for a tool with no leasable scope (Go's ok=false).
 */
export function deriveLeaseScope(tc: ToolCall): LeaseScope | undefined {
  const slug = tc.mcpServerSlug;
  if (tc.approvalPolicySource === ApprovalPolicySource.HOOK) {
    return {
      category: "",
      server: slug,
      hook: tc.approvalPolicyHook,
      tool: tc.name,
    };
  }
  if (slug !== "") {
    return { category: "", server: slug, tool: "" };
  }
  const category = toolApprovalCategory(tc.name);
  if (category !== undefined) {
    return { category, server: "", tool: "" };
  }
  return undefined;
}

/** Value equality for lease scopes (Go compares the struct with ==). */
export function sameLeaseScope(a: LeaseScope, b: LeaseScope): boolean {
  return (
    a.category === b.category &&
    a.server === b.server &&
    a.hook === b.hook &&
    a.tool === b.tool
  );
}
