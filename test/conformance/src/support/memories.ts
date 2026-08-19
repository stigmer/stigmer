// Canonical valid Memory fixtures + the consent-lifecycle contract copy
// for the conformance suite.
// Domain: conformance support.
//
// A Memory is an agent-proposed, user-confirmed fact (DD-004/DD-005/
// DD-006): the fact text lives in spec.content; the subject and
// provenance are SERVER-OWNED at create (client values overwritten);
// the consent lifecycle (proposed → confirmed/rejected) lives in status
// and is written only by create and the confirm/reject commands.
//
// The exported copy constants are CROSS-EDITION CONTRACT STRINGS: the Go
// controller (stigmer) and the Java handlers (stigmer-cloud) each pin
// them in their own unit tests, and this suite asserts them over the
// wire. A change to any of them is a contract change, not a copy edit.
import type { MessageInitShape } from "@bufbuild/protobuf";
import { MemorySchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";

export const MEMORY_API_VERSION = "agentic.stigmer.ai/v1";
export const MEMORY_KIND = "Memory";

// The server-enforced per-subject-per-org record ceiling, all lifecycle
// states counted (DD-006 D5).
export const MEMORY_CAP = 100;

// ─── Contract copy (byte-pinned in both editions' unit tests) ──────────────

// Refusing a create once the subject's ceiling is reached — visible-full,
// never silent eviction (the ChatGPT Memory-Full pattern, DD-006 D5).
export const MEMORY_FULL_MESSAGE =
  "memory is full — review and delete existing memories";

// Refusing a create while the organization has not enabled memory —
// memory writes fail closed (DD-005 D2).
export function memoryDisabledMessage(org: string): string {
  return `memory is not enabled for organization ${org} — an organization admin can enable it in organization preferences`;
}

// Refusing confirm on a rejected memory: the decision stands; a fresh
// proposal is the way back.
export const MEMORY_CONFIRM_REJECTED_MESSAGE =
  "memory was rejected — delete it and let the agent propose it again";

// Refusing reject on a confirmed memory: deletion IS the revocation.
export const MEMORY_REJECT_CONFIRMED_MESSAGE =
  "memory was confirmed — delete it to stop it from being recalled";

// Refusing updates that touch the server-owned identity fields.
export const MEMORY_SUBJECT_IMMUTABLE_MESSAGE =
  "spec.subject_identity_account_id is immutable — it is derived from the capturing credential at create";
export const MEMORY_PROVENANCE_IMMUTABLE_MESSAGE =
  "spec.provenance is immutable — it records where the fact came from";

// ─── Fixtures ──────────────────────────────────────────────────────────────

export interface MemoryOptions {
  content?: string;
  // Optional display name; a memory without one defaults name/slug from
  // its own generated id (memories are id-addressed records).
  name?: string;
}

// A valid Memory carrying only what a client legitimately supplies: org
// and content. Subject, provenance, and lifecycle are server-owned — the
// suite asserts they come back server-written even when forged (see the
// suite's server-owned-fields test, which builds its own request).
export function makeMemory(
  org: string,
  options: MemoryOptions = {},
): MessageInitShape<typeof MemorySchema> {
  return {
    apiVersion: MEMORY_API_VERSION,
    kind: MEMORY_KIND,
    metadata: { org, ...(options.name ? { name: options.name } : {}) },
    spec: {
      content: options.content ?? "Prefers terse answers with code examples.",
    },
  };
}
