/**
 * Approval fingerprint — the exact-match enforcement identity for the HITL Tool
 * Execution Gateway (Phase 2).
 *
 * A fingerprint is `HMAC-SHA256(key, canonicalForm)` over a canonicalized tool
 * action (see {@link file://./approval-canonicalize.ts}). It answers exactly one
 * question at the moment of side effect: "is *this* action the one the user
 * approved?" An approval is bound to the canonical identity of the action, not to
 * the transient id of the proposing tool call, so a re-driven action that differs
 * from what was approved is re-asked — never silently executed.
 *
 * Why HMAC and not a bare SHA-256 (binding canonical decision,
 * design-decisions/approval-fingerprint-vs-march-rollback.md, Rule 4): the
 * fingerprint is an authorization token, not a correlation key. Keying it under a
 * Stigmer-held secret means a model (or a compromised workspace) cannot forge a
 * value that the gateway will accept. In Phase 2 the fingerprint is
 * recompute-and-compare at one trusted layer (no bearer token crosses a wire), so
 * the anti-forgery property is forward-looking — it earns its keep when a lease
 * later becomes a server-issued bearer token (Phase 7). We pay the small cost now
 * to avoid a migration that re-keys every persisted approval later.
 *
 * Two fidelities share this one canonicalization core, because the two
 * enforcement substrates differ (see the Phase-2 plan, "two enforcement
 * substrates, not one"):
 *
 *  - FULL ({@link computeApprovalFingerprint}) — HMAC over the full canonical
 *    action (tool + paths + shellCommand + args). Used by the in-process
 *    deep-agent gateway, where approve-time and execute-time observe the same
 *    arg shape (LangGraph checkpoint replay), so the action can be matched at
 *    full fidelity.
 *  - COARSE ({@link computeCoarseApprovalFingerprint}) — HMAC over
 *    (category, salient) only. Used by the out-of-process Cursor deny-oracle
 *    hook, whose stdin payload names the same action with a different taxonomy
 *    (`Write` vs `edit`, `file_path` vs `path`) and cannot reproduce the full
 *    args. The coarse projection is the documented, substrate-forced coarsening
 *    that lets the hook-side and stream-side fingerprints agree; it is the
 *    successor identity for execute-cursor's grant token.
 *
 * The fingerprint is enforcement-only and never a correlation key — correlation
 * stays `approval_request_id` + `tool_call_id`.
 */

import { createHmac, type BinaryLike } from "node:crypto";
import {
  canonicalJson,
  canonicalToolActionJson,
  canonicalizeToolAction,
  type ToolActionInput,
} from "./approval-canonicalize.js";
import { toolApprovalCategory } from "./tool-kind.js";

/**
 * Version tag prefixed to every fingerprint. Bumping it is the migration lever
 * if the canonical form or the MAC primitive ever changes: an old lease and a
 * new computation will not compare equal, so a version skew re-asks (safe) rather
 * than silently mismatching. Keep in lockstep with the Go/Java editions.
 */
export const APPROVAL_FINGERPRINT_VERSION = "v1";

/** The HMAC key. Raw bytes (Buffer) in production; a UTF-8 string in tests. */
export type FingerprintKey = BinaryLike;

/**
 * Full-fidelity fingerprint for the in-process deep-agent gateway. Distinct
 * actions (different tool, paths, command, or args) yield distinct fingerprints;
 * the same action is byte-stable across re-invocations.
 */
export function computeApprovalFingerprint(key: FingerprintKey, input: ToolActionInput): string {
  return tagged(hmacHex(key, canonicalToolActionJson(input)));
}

/**
 * The substrate-coarsened identity of a tool action — the only fidelity the
 * Cursor deny-oracle hook can reproduce from its stdin payload.
 *
 * Mirrors execute-cursor's `toolIdentity` so the two converge on one definition:
 * - `tool` is the cross-taxonomy {@link toolApprovalCategory} (`write`/`delete`/
 *   `shell`) for gated built-ins, the tool name for MCP tools (whose name is
 *   stable across layers), or the trimmed tool name for non-gated built-ins
 *   (never lease-matched, so the fallback is harmless).
 * - `salient` is the single resource the action targets (a normalized path or the
 *   shell command), reusing the full form's normalization so one rule governs
 *   both fidelities. Empty for MCP tools, which are matched by `tool` alone.
 */
export interface CoarseToolIdentity {
  tool: string;
  mcpServerSlug: string;
  salient: string;
}

export function coarseToolIdentity(input: ToolActionInput): CoarseToolIdentity {
  const canonical = canonicalizeToolAction(input);
  if (canonical.mcpServerSlug) {
    return { tool: input.toolName.trim(), mcpServerSlug: canonical.mcpServerSlug, salient: "" };
  }
  const category = toolApprovalCategory(input.toolName);
  return {
    tool: category ?? input.toolName.trim(),
    mcpServerSlug: "",
    salient: canonical.paths[0] || canonical.shellCommand || "",
  };
}

/**
 * Fingerprint an already-reduced {@link CoarseToolIdentity}. Split out from
 * {@link computeCoarseApprovalFingerprint} so a substrate that has *already*
 * reduced a tool call to its (tool, mcpServerSlug, salient) identity — the Cursor
 * harness, whose hook and stream both key on a raw, un-normalized salient that
 * the bash hook can reproduce without a workspace root — can fingerprint that
 * exact identity through the one shared HMAC+canonical-JSON path, instead of
 * re-deriving the salient via {@link canonicalizeToolAction} (which normalizes
 * paths and would diverge from the hook's raw value).
 */
export function fingerprintCoarseIdentity(key: FingerprintKey, identity: CoarseToolIdentity): string {
  return tagged(hmacHex(key, canonicalJson(identity)));
}

/**
 * Coarse fingerprint for the out-of-process Cursor hook. By construction, two
 * actions that name the same operation in different taxonomies (`Write` vs
 * `edit`) over the same resource collapse to one fingerprint — this is what makes
 * the hook-side (deny/grant) and stream-side (reconciliation) values agree.
 */
export function computeCoarseApprovalFingerprint(key: FingerprintKey, input: ToolActionInput): string {
  return fingerprintCoarseIdentity(key, coarseToolIdentity(input));
}

/**
 * Derive the per-execution fingerprint key from a runner-held master secret.
 *
 * The key is scoped to one `execution_id`: stable across Temporal re-invocations
 * of the same execution (the gateway approves on one invocation and enforces on
 * the next), and isolated between executions so a fingerprint approved for one
 * cannot be replayed against another. The master-secret source is wired when the
 * gateway first consumes the fingerprint (Slices C/D); until then this is
 * exercised only by tests against a fixed master secret.
 */
export function deriveExecutionFingerprintKey(masterSecret: FingerprintKey, executionId: string): Buffer {
  return createHmac("sha256", masterSecret).update(executionId, "utf8").digest();
}

function hmacHex(key: FingerprintKey, canonical: string): string {
  return createHmac("sha256", key).update(canonical, "utf8").digest("hex");
}

function tagged(mac: string): string {
  return `${APPROVAL_FINGERPRINT_VERSION}:${mac}`;
}
