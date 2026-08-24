/**
 * LeaseScope — ports approval/lease_scope.go: the class of actions a
 * single APPROVE_ALL decision covers (the server edition of the runner's
 * ActiveLeases scope; see deriveActiveLeases in
 * backend/services/runner/src/shared/approval-policy.ts).
 *
 * An APPROVE_ALL ("approve all of this kind") is not an all-or-nothing
 * gate bypass: it grants a run-lifetime lease scoped to ONE class of
 * action — the clicked tool's built-in category (write/delete/shell) for
 * a built-in, or its MCP server for an MCP tool. Two tool calls belong to
 * the same scope when their derived scopes are equal (compare with
 * sameLeaseScope — TS has no comparable-struct ==).
 *
 * Exactly one of category/server is non-empty for a derivable scope; the
 * derivation returns undefined when the tool has no scope (a read-only
 * built-in, an unknown name) — callers treat that as matching nothing.
 */
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";

import { toolApprovalCategory } from "./tool-category.js";

export interface LeaseScope {
  /** Built-in approval category (write/delete/shell); empty for MCP. */
  readonly category: string;
  /** MCP server slug; empty for a built-in. */
  readonly server: string;
}

/**
 * Reduces a tool call to the scope its APPROVE_ALL would lease. MCP
 * server slug takes precedence over the built-in category lookup,
 * matching the runner's deriveActiveLeases ordering byte-for-byte (a
 * real built-in never carries a server slug and a real MCP tool never
 * resolves to a category, so the order is parity insurance, not a
 * behavioral choice). Returns undefined for a tool with no leasable
 * scope (Go's ok=false).
 */
export function deriveLeaseScope(tc: ToolCall): LeaseScope | undefined {
  const slug = tc.mcpServerSlug;
  if (slug !== "") {
    return { category: "", server: slug };
  }
  const category = toolApprovalCategory(tc.name);
  if (category !== undefined) {
    return { category, server: "" };
  }
  return undefined;
}

/** Value equality for lease scopes (Go compares the struct with ==). */
export function sameLeaseScope(a: LeaseScope, b: LeaseScope): boolean {
  return a.category === b.category && a.server === b.server;
}
