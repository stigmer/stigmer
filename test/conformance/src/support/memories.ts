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
import type { InitShape } from "./init-shape";
import { MemorySchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import type { ConformanceClients } from "../harness/clients";
import type { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "./naming";

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
): InitShape<typeof MemorySchema> {
  return {
    apiVersion: MEMORY_API_VERSION,
    kind: MEMORY_KIND,
    metadata: { org, ...(options.name ? { name: options.name } : {}) },
    spec: {
      content: options.content ?? "Prefers terse answers with code examples.",
    },
  };
}

export interface OrgWithConfirmedFacts {
  // The org's slug — the scope the agent and its executions run in.
  org: string;
  // The confirmed memories' ids in CAPTURE ORDER, which is the snapshot order
  // the retriever sends candidates in (the order the selection arms compare
  // injected_memory_ids against).
  memoryIds: string[];
}

// An org with the memory switch ON (the org flag alone gates OSS recall — the
// single-user subject sentinel), plus `count` facts run through the REAL
// consent lifecycle: captured via create, confirmed via the consent RPC.
// Shared by the memory-retrieval (no-embedder) and memory-selection
// (embedder) execution suites, which differ only in the mock's posture.
export async function provisionOrgWithConfirmedFacts(
  clients: ConformanceClients,
  fixtures: FixtureTracker,
  count: number,
): Promise<OrgWithConfirmedFacts> {
  const org = await clients.organizationCommand.create({
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: { name: uniqueName("retrorg") },
    spec: { preferences: { memoryEnabled: true } },
  });
  fixtures.defer(() => clients.organizationCommand.delete({ value: org.metadata!.id }));
  const slug = org.metadata!.slug;

  const memoryIds: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const memory = await clients.memoryCommand.create(
      makeMemory(slug, { content: `Durable fact number ${i} about this user.` }),
    );
    fixtures.defer(async () => {
      try {
        await clients.memoryCommand.delete({ value: memory.metadata!.id });
      } catch {
        // Removed with the org.
      }
    });
    await clients.memoryCommand.confirm({ value: memory.metadata!.id });
    memoryIds.push(memory.metadata!.id);
  }
  return { org: slug, memoryIds };
}
