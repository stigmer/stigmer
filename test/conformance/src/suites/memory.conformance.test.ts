// Conformance suite for the Memory domain.
// Domain: agentic / memory — agent-proposed, user-confirmed facts
// (stigmer/stigmer#293 Phase 2, DD-004/DD-005/DD-006).
//
// Drives MemoryCommandController + MemoryQueryController through the raw
// proto stubs and asserts the contract: fail-closed enablement at create
// (org memory_enabled off -> FAILED_PRECONDITION with pinned copy),
// server ownership of subject/lifecycle (forged values come back
// server-written), capture-path-supplied provenance (the Stage 3
// contract: the supplied triple is stored, tool_call_id force-cleared,
// a direct create stays empty, and the field is immutable after
// create), the consent lifecycle matrix (proposed -> confirmed/rejected,
// idempotent re-decisions, cross-decisions refused with pinned copy),
// update immutability (subject/provenance locked, content editable,
// lifecycle preserved), any-state delete, the per-subject record
// ceiling (visible-full, never silent eviction), and org-scoped
// listing.
//
// The create RPC's strict first-party-human-operator gate is capability
// split (firstPartyMemoryCapture, see targets/target.ts): local OSS runs
// the full matrix (single-user posture, no gate); on cloud the primary
// conformance user is a PlatformClient-minted token — the credential
// class DD-002 D4's amendment deliberately excludes — so this suite pins
// the gate refusal itself, and the full cloud lifecycle is covered by
// test/integration (seeded rows + FGA) and the Java handler unit tests.
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MemoryLifecycleState } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/enum_pb";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "../support/naming";
import {
  MEMORY_CAP,
  MEMORY_CONFIRM_REJECTED_MESSAGE,
  MEMORY_FULL_MESSAGE,
  MEMORY_PROVENANCE_IMMUTABLE_MESSAGE,
  MEMORY_REJECT_CONFIRMED_MESSAGE,
  MEMORY_SUBJECT_IMMUTABLE_MESSAGE,
  makeMemory,
  memoryDisabledMessage,
} from "../support/memories";
import { createTarget, type TargetProfile } from "../targets";

const ORG_API_VERSION = "tenancy.stigmer.ai/v1";
const ORG_KIND = "Organization";

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

// Provisions an org WITH the memory switch in the requested position.
// The suite creates its own orgs (the organization suite's pattern) so
// the enablement flag is under its control on every target.
async function createOrg(memoryEnabled: boolean): Promise<string> {
  const org = await clients.organizationCommand.create({
    apiVersion: ORG_API_VERSION,
    kind: ORG_KIND,
    metadata: { name: uniqueName("memorg") },
    spec: { preferences: { memoryEnabled } },
  });
  fixtures.defer(() => clients.organizationCommand.delete({ value: org.metadata!.id }));
  // Organization id equals slug — the tenancy-root addressing rule.
  return org.metadata!.slug;
}

async function createMemory(org: string, content?: string) {
  const memory = await clients.memoryCommand.create(makeMemory(org, { content }));
  fixtures.defer(async () => {
    try {
      await clients.memoryCommand.delete({ value: memory.metadata!.id });
    } catch {
      // Already deleted by the test — any-state delete is itself asserted.
    }
  });
  return memory;
}

describe("Memory conformance", () => {
  it("create is refused for callers outside the first-party-human gate", async () => {
    // Cloud-only pin (see the suite header): the primary conformance
    // user is a PlatformClient-minted token, and even with the org
    // switch ON the gate refuses — client-side context never overrides
    // the control plane's caller classification.
    if (target.capabilities.firstPartyMemoryCapture) return;

    const org = await createOrg(true);
    await expectGrpcCode(
      () => clients.memoryCommand.create(makeMemory(org)),
      Code.PermissionDenied,
      "memory create as a platform-client-minted user",
    );
  });

  it("create fails closed while the organization has memory disabled", async () => {
    if (!target.capabilities.firstPartyMemoryCapture) return;

    const org = await createOrg(false);
    const err = await expectGrpcCode(
      () => clients.memoryCommand.create(makeMemory(org)),
      Code.FailedPrecondition,
      "memory create with the org switch off",
    );
    expect(err.message).toContain(memoryDisabledMessage(org));
  });

  it("create starts proposed and server-writes every owned field", async () => {
    if (!target.capabilities.firstPartyMemoryCapture) return;

    const org = await createOrg(true);
    // Forge the server-owned fields; all of them must come back
    // server-written. (Provenance left the server-owned set in Stage 3 —
    // its capture-path contract is pinned by the tests below.)
    const created = await clients.memoryCommand.create({
      ...makeMemory(org, { content: "Deploys to us-east-1." }),
      spec: {
        content: "Deploys to us-east-1.",
        subjectIdentityAccountId: "ida_forged",
      },
      status: { lifecycleState: MemoryLifecycleState.lifecycle_state_confirmed },
    });
    fixtures.defer(() => clients.memoryCommand.delete({ value: created.metadata!.id }));

    expect(created.metadata?.id).toMatch(/^mem_/);
    expect(created.spec?.content).toBe("Deploys to us-east-1.");
    // Subject derivation differs per edition (OSS: the single-user
    // sentinel ""; cloud: the caller's identity account) — but a forged
    // value never survives on either.
    expect(created.spec?.subjectIdentityAccountId).not.toBe("ida_forged");
    expect(created.status?.lifecycleState).toBe(
      MemoryLifecycleState.lifecycle_state_proposed,
    );
    expect(created.status?.stateChangedAt).toBeDefined();
  });

  it("create stores capture-path provenance, force-clearing tool_call_id (Stage 3)", async () => {
    if (!target.capabilities.firstPartyMemoryCapture) return;

    // The Stage 3 provenance contract (owner-ratified 2026-08-22): the
    // capture path — the remember tool via the runner-synthesized
    // attachment — threads agent/session/execution, and the eligible
    // capture caller's supplied triple is stored (OSS local trust: every
    // caller is the operator; cloud: sandbox credential required, pinned
    // in the Java handler tests). tool_call_id is unreachable via MCP in
    // v1, so a supplied value could only be an invention: force-cleared.
    const org = await createOrg(true);
    const created = await clients.memoryCommand.create({
      ...makeMemory(org, { content: "Works primarily in Go." }),
      spec: {
        content: "Works primarily in Go.",
        provenance: {
          agentId: "agt_1",
          sessionId: "ses_1",
          agentExecutionId: "aex_1",
          toolCallId: "call_invented",
        },
      },
    });
    fixtures.defer(() => clients.memoryCommand.delete({ value: created.metadata!.id }));

    expect(created.spec?.provenance?.agentId).toBe("agt_1");
    expect(created.spec?.provenance?.sessionId).toBe("ses_1");
    expect(created.spec?.provenance?.agentExecutionId).toBe("aex_1");
    expect(created.spec?.provenance?.toolCallId ?? "").toBe("");
  });

  it("create without provenance keeps the field empty — a direct create has no origin", async () => {
    if (!target.capabilities.firstPartyMemoryCapture) return;

    const org = await createOrg(true);
    const created = await createMemory(org, "Prefers table-driven tests.");
    expect(created.spec?.provenance).toBeUndefined();
  });

  it("rejects content outside the 1..500 char contract", async () => {
    if (!target.capabilities.firstPartyMemoryCapture) return;

    const org = await createOrg(true);
    await expectGrpcCode(
      () => clients.memoryCommand.create(makeMemory(org, { content: "" })),
      Code.InvalidArgument,
      "memory create with empty content",
    );
    await expectGrpcCode(
      () => clients.memoryCommand.create(makeMemory(org, { content: "x".repeat(501) })),
      Code.InvalidArgument,
      "memory create with 501-char content",
    );
    // Exactly at the cap is inside the contract.
    await createMemory(org, "x".repeat(500));
  });

  it("confirm decides a proposal, idempotently, and never flips a rejection", async () => {
    if (!target.capabilities.firstPartyMemoryCapture) return;

    const org = await createOrg(true);
    const memory = await createMemory(org);
    const id = { value: memory.metadata!.id };

    const confirmed = await clients.memoryCommand.confirm(id);
    expect(confirmed.status?.lifecycleState).toBe(
      MemoryLifecycleState.lifecycle_state_confirmed,
    );

    // Idempotent no-op: same state, same decision timestamp (no write).
    const again = await clients.memoryCommand.confirm(id);
    expect(again.status?.stateChangedAt).toEqual(confirmed.status?.stateChangedAt);

    // The opposite decision is refused with the pinned copy.
    const err = await expectGrpcCode(
      () => clients.memoryCommand.reject(id),
      Code.FailedPrecondition,
      "reject after confirm",
    );
    expect(err.message).toContain(MEMORY_REJECT_CONFIRMED_MESSAGE);
  });

  it("reject decides a proposal and never flips into a confirmation", async () => {
    if (!target.capabilities.firstPartyMemoryCapture) return;

    const org = await createOrg(true);
    const memory = await createMemory(org);
    const id = { value: memory.metadata!.id };

    const rejected = await clients.memoryCommand.reject(id);
    expect(rejected.status?.lifecycleState).toBe(
      MemoryLifecycleState.lifecycle_state_rejected,
    );

    await clients.memoryCommand.reject(id); // idempotent no-op

    const err = await expectGrpcCode(
      () => clients.memoryCommand.confirm(id),
      Code.FailedPrecondition,
      "confirm after reject",
    );
    expect(err.message).toContain(MEMORY_CONFIRM_REJECTED_MESSAGE);
  });

  it("commands on a missing memory answer NotFound", async () => {
    const ghost = { value: "mem_00000000000000000000000000" };
    await expectGrpcCode(() => clients.memoryQuery.get(ghost), Code.NotFound, "get missing");
    await expectGrpcCode(() => clients.memoryCommand.confirm(ghost), Code.NotFound, "confirm missing");
    await expectGrpcCode(() => clients.memoryCommand.reject(ghost), Code.NotFound, "reject missing");
    await expectGrpcCode(() => clients.memoryCommand.delete(ghost), Code.NotFound, "delete missing");
  });

  it("update edits the fact text only — identity locked, lifecycle preserved", async () => {
    if (!target.capabilities.firstPartyMemoryCapture) return;

    const org = await createOrg(true);
    const memory = await createMemory(org);
    const id = memory.metadata!.id;
    await clients.memoryCommand.confirm({ value: id });

    // A wholesale spec replacement editing content only (status wiped,
    // as generated update mappers send it): the decision must survive
    // by mechanism.
    const updated = await clients.memoryCommand.update({
      apiVersion: memory.apiVersion,
      kind: memory.kind,
      metadata: memory.metadata,
      spec: {
        content: "Deploys to eu-west-1.",
        subjectIdentityAccountId: memory.spec!.subjectIdentityAccountId,
        provenance: memory.spec!.provenance,
      },
    });
    expect(updated.spec?.content).toBe("Deploys to eu-west-1.");
    expect(updated.status?.lifecycleState).toBe(
      MemoryLifecycleState.lifecycle_state_confirmed,
    );

    // Re-aiming the record at another person is refused.
    const subjectErr = await expectGrpcCode(
      () =>
        clients.memoryCommand.update({
          apiVersion: memory.apiVersion,
          kind: memory.kind,
          metadata: memory.metadata,
          spec: { content: "x", subjectIdentityAccountId: "ida_someone_else" },
        }),
      Code.FailedPrecondition,
      "update changing the subject",
    );
    expect(subjectErr.message).toContain(MEMORY_SUBJECT_IMMUTABLE_MESSAGE);

    // Inventing attribution is refused.
    const provenanceErr = await expectGrpcCode(
      () =>
        clients.memoryCommand.update({
          apiVersion: memory.apiVersion,
          kind: memory.kind,
          metadata: memory.metadata,
          spec: {
            content: "x",
            subjectIdentityAccountId: memory.spec!.subjectIdentityAccountId,
            provenance: { agentId: "agt_invented" },
          },
        }),
      Code.FailedPrecondition,
      "update changing provenance",
    );
    expect(provenanceErr.message).toContain(MEMORY_PROVENANCE_IMMUTABLE_MESSAGE);
  });

  it("delete works in every lifecycle state — never refused on lifecycle grounds", async () => {
    if (!target.capabilities.firstPartyMemoryCapture) return;

    const org = await createOrg(true);

    const proposed = await createMemory(org, "Proposed fact.");
    const confirmed = await createMemory(org, "Confirmed fact.");
    await clients.memoryCommand.confirm({ value: confirmed.metadata!.id });
    const rejected = await createMemory(org, "Rejected fact.");
    await clients.memoryCommand.reject({ value: rejected.metadata!.id });

    for (const record of [proposed, confirmed, rejected]) {
      const id = { value: record.metadata!.id };
      const deleted = await clients.memoryCommand.delete(id);
      expect(deleted.metadata?.id).toBe(record.metadata?.id);
      await expectGrpcCode(() => clients.memoryQuery.get(id), Code.NotFound, "get after delete");
    }
  });

  it("list is org-scoped", async () => {
    if (!target.capabilities.firstPartyMemoryCapture) return;

    const org = await createOrg(true);
    const other = await createOrg(true);
    const mine = await createMemory(org, "First fact.");
    await createMemory(other, "Another org's fact.");

    const list = await clients.memoryQuery.list({
      org,
      pageInfo: { num: 1, size: MEMORY_CAP },
    });
    expect(list.items.map((m) => m.metadata?.id)).toContain(mine.metadata?.id);
    for (const item of list.items) {
      expect(item.metadata?.org).toBe(org);
    }
  });

  it("refuses the record past the per-subject ceiling, visibly", async () => {
    if (!target.capabilities.firstPartyMemoryCapture) return;

    const org = await createOrg(true);
    for (let i = 0; i < MEMORY_CAP; i++) {
      await createMemory(org, `Fact number ${i}.`);
    }

    const err = await expectGrpcCode(
      () => clients.memoryCommand.create(makeMemory(org, { content: "One too many." })),
      Code.FailedPrecondition,
      "create past the ceiling",
    );
    expect(err.message).toContain(MEMORY_FULL_MESSAGE);
  });
});
