/**
 * The Cursor harness's built-in gating helpers.
 *
 * The approval default itself is harness-agnostic and lives once, in
 * `shared/approval-policy.ts`: mutating built-ins ask by category, an MCP tool
 * asks when its server marks it destructive, a lease or the pre-armed
 * `auto_approve_all` lets a call through. This module owns only what the
 * Cursor hook needs on top: the gated built-in set in the HOOK's names, the
 * category each maps to, and the salient argument a grant matches on.
 */

import { toolApprovalCategory, type ToolApprovalCategory } from "../../shared/tool-kind.js";

// Re-exported so this harness's modules import the shared default from one
// local place; nothing here wraps or re-implements it.
export {
  resolveApprovalMessage,
  resolveBuiltInApprovalMessage,
  POLICY_ENGINE_VERSION,
} from "../../shared/approval-policy.js";
export type { McpApprovalDefault, PolicySource } from "../../shared/approval-policy.js";

/**
 * Built-in Cursor tools the preToolUse hook gates, named as the hook receives
 * them.
 *
 * Critical: the Cursor preToolUse hook and the SDK event stream use DIFFERENT
 * tool taxonomies for the same operation. The hook's `tool_name` is PascalCase
 * (`Write` for any file create/edit, `Shell`, `Delete`); the stream's
 * `event.name` is lowercase (`edit`, `shell`, `delete`). This set is the HOOK
 * taxonomy because it is consulted only to build the hook's gated set and its
 * name->category mapping. Cross-layer correlation never compares these raw
 * names — it uses {@link approvalCategory} (see below).
 *
 * Only mutating and destructive tools are gated; everything else (read-only
 * built-ins, and MCP tools, which the hook gates on their own event) is
 * allowed. This "gate the dangerous set, allow the rest" model is the
 * platform's one approval rule, read through the shared `toolApprovalCategory`
 * (`shared/tool-kind.ts`) that the native gate (`middleware/approval-gate.ts`
 * `resolveToolApproval`) also reads: one taxonomy, two enforcement points. It
 * is deliberately fail-OPEN for an unknown name: whether an agent may call a
 * tool at all is its tool lists' question, answered by the hook's scope arm
 * ahead of this gate (`hook-scope.ts`), not by approval.
 */
const BUILT_IN_GATED: ReadonlySet<string> = new Set([
  "Write",
  "StrReplace",
  "EditNotebook",
  "Shell",
  "Delete",
]);

/**
 * Canonical approval category for a gated tool.
 *
 * This is the cross-substrate identity, and it lives in ONE place:
 * {@link toolApprovalCategory} in shared/tool-kind.ts (shared with the deep-agent
 * gateway). The names below are kept as the Cursor harness's public surface
 * (`approvalCategory` / `ApprovalCategory`) so existing imports do not churn, but
 * they are exact aliases — there is no second implementation to drift.
 *
 * Why this matters here: the hook (`Write`/`Shell`/`Delete`) and the stream
 * (`edit`/`shell`/`delete`) name the same operation differently, so neither raw
 * name is a stable cross-layer identity. The category collapses both onto one
 * value so the denial ledger (recorded by the hook) correlates to the streamed
 * tool call (read by the runner) and an approval grant matches the agent's
 * re-attempt on reinvocation regardless of which taxonomy named it.
 */
export type ApprovalCategory = ToolApprovalCategory;

export const approvalCategory = toolApprovalCategory;

/**
 * The salient argument fields — the resource a built-in acts on — are the
 * platform's one list, `shared/args-preview.ts` `SALIENT_ARG_FIELDS` (moved
 * there in #1097: the transcript builder previews every row over it for
 * both harnesses). Re-exported here for this harness's identity code and the
 * generated hook script, which inject it so the runner and the hook never
 * disagree on which field to match.
 */
export { SALIENT_ARG_FIELDS } from "../../shared/args-preview.js";
import { SALIENT_ARG_FIELDS } from "../../shared/args-preview.js";

/**
 * Returns the built-in tool names that require approval (the gated set the
 * preToolUse hook denies unless auto-approved or granted on reinvocation).
 *
 * These are HOOK-taxonomy names (PascalCase), because the hook matches its own
 * `tool_name`. See {@link approvalCategory} for the cross-layer identity.
 */
export function getBuiltInGatedList(): string[] {
  return [...BUILT_IN_GATED];
}

/**
 * Returns the gated built-in tools as `(hookToolName, category)` pairs.
 *
 * Injected into the generated preToolUse hook so the bash script can map its
 * incoming `tool_name` to the canonical category used for the denial/grant
 * token — the same category the runner computes from the stream side via
 * {@link approvalCategory}. Authoring it here keeps the mapping single-sourced;
 * a gated built-in with no category would be a programming error, so it is
 * filtered out (and would simply not be gated rather than crash the hook).
 */
export function getBuiltInGatedCategories(): Array<[string, ApprovalCategory]> {
  const pairs: Array<[string, ApprovalCategory]> = [];
  for (const name of BUILT_IN_GATED) {
    const category = approvalCategory(name);
    if (category) pairs.push([name, category]);
  }
  return pairs;
}

/**
 * Extract the canonical "salient" argument value that identifies the resource a
 * built-in tool acts on (the file path, the shell command, …). Returns "" when
 * no salient field is present. Kept in lockstep with SALIENT_ARG_FIELDS and the
 * generated hook script so grant matching at deny-time and reinvoke-time never
 * drift.
 */
export function extractArgKey(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  for (const field of SALIENT_ARG_FIELDS) {
    const v = args[field];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "";
}

