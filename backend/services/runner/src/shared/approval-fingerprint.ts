/**
 * Approval fingerprint — the exact-match enforcement identity for the HITL Tool
 * Execution Gateway.
 *
 * A fingerprint is `HMAC-SHA256(key, canonicalForm)` over a canonicalized tool
 * action (see {@link file://./approval-canonicalize.ts}). It answers exactly one
 * question at the moment of side effect: "is *this* action the one the user
 * approved?" An approval is bound to the canonical identity of the action, not to
 * the transient id of the proposing tool call, so a re-driven action that differs
 * from what was approved is re-asked — never silently executed.
 *
 * Why HMAC and not a bare SHA-256: the
 * fingerprint is an authorization token, not a correlation key. Keying it under a
 * Stigmer-held secret means a model (or a compromised workspace) cannot forge a
 * value that the gateway will accept. Today the fingerprint is
 * recompute-and-compare at one trusted layer (no bearer token crosses a wire), so
 * the anti-forgery property is forward-looking — it earns its keep when a lease
 * later becomes a server-issued bearer token. We pay the small cost now
 * to avoid a migration that re-keys every persisted approval later.
 *
 * The fingerprint is HMAC over the full canonical action (tool + paths +
 * shellCommand + args), {@link computeApprovalFingerprint}: approve-time and
 * execute-time observe the same arg shape (LangGraph checkpoint replay; the
 * Claude engine's resumed call), so the action is matched at full fidelity.
 *
 * The fingerprint is enforcement-only and never a correlation key — correlation
 * stays `approval_request_id` + `tool_call_id`.
 */

import { createHmac, type BinaryLike } from "node:crypto";
import {
  canonicalToolActionJson,
  type ToolActionInput,
} from "./approval-canonicalize.js";

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
 * The fingerprint of one tool action. Distinct
 * actions (different tool, paths, command, or args) yield distinct fingerprints;
 * the same action is byte-stable across re-invocations.
 */
export function computeApprovalFingerprint(key: FingerprintKey, input: ToolActionInput): string {
  return tagged(hmacHex(key, canonicalToolActionJson(input)));
}

/**
 * Derive the per-execution fingerprint key from a runner-held master secret.
 *
 * The key is scoped to one `execution_id`: stable across Temporal re-invocations
 * of the same execution (the gateway approves on one invocation and enforces on
 * the next), and isolated between executions so a fingerprint approved for one
 * cannot be replayed against another. The master secret is the runner's HITL
 * secret (fingerprint-secret.ts), which both harnesses' turn setup reads.
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
