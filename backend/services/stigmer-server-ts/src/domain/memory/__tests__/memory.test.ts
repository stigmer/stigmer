/**
 * Pins the memory domain against Go's pkg/domain/memory tests — through
 * the REAL stack: a composed server on an ephemeral port, a native gRPC
 * client, and the full interceptor chain.
 *
 * The load-bearing pins:
 *   - create starts the consent lifecycle at proposed with
 *     state_changed_at set; the subject is forced to the OSS single-user
 *     sentinel "" (DD-005 D2); provenance is stored as supplied with
 *     tool_call_id force-cleared (the Stage 3 contract); an unnamed
 *     create defaults its name from the minted mem_ id; a missing org is
 *     the exact InvalidArgument copy;
 *   - enablement fails CLOSED: org switch off is the exact formatted
 *     FailedPrecondition copy, an unknown org is NotFound;
 *   - the 100-per-subject-per-org ceiling refuses the 101st record with
 *     the exact copy and never blocks another org;
 *   - confirm/reject are one contract with opposite verdicts: idempotent
 *     re-decisions write NOTHING (no audit bump), cross-decisions are
 *     refused with the pinned copy;
 *   - update grafts metadata+spec+status.audit onto the LIVE row: the
 *     lifecycle survives a content edit by MECHANISM, subject/provenance
 *     edits are refused with the exact copy, and a client-sent lifecycle
 *     on update is ignored;
 *   - delete works from every lifecycle state (the any-state guarantee).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MemoryCommandController } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/command_pb";
import { MemoryQueryController } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/query_pb";
import { MemorySchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import type { Memory } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { MemoryLifecycleState } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { generateId } from "../../../pipeline/steps/defaults.js";
import {
  MAX_MEMORIES_PER_SUBJECT,
  MEMORY_CONFIRM_REJECTED_MESSAGE,
  MEMORY_FULL_MESSAGE,
  MEMORY_PROVENANCE_IMMUTABLE_MESSAGE,
  MEMORY_REJECT_CONFIRMED_MESSAGE,
  MEMORY_SUBJECT_IMMUTABLE_MESSAGE,
  memoryDisabledMessage,
} from "../constants.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const MEMORY_API_VERSION = "agentic.stigmer.ai/v1";
const MEMORY_KIND = "Memory";
const ORG_API_VERSION = "tenancy.stigmer.ai/v1";
const ORG_KIND = "Organization";

let dir: string;
let server: ComposedServer;
let transport: Transport;
let orgCommand: Client<typeof OrganizationCommandController>;
let command: Client<typeof MemoryCommandController>;
let query: Client<typeof MemoryQueryController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "memory-domain-test-"));
  server = composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      DB_PATH: path.join(dir, "stigmer.db"),
      // Keep the artifact store inside the test dir — the default
      // resolves to ~/.stigmer, which tests must never touch.
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
  orgCommand = createClient(OrganizationCommandController, transport);
  command = createClient(MemoryCommandController, transport);
  query = createClient(MemoryQueryController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

let orgCounter = 0;
/**
 * Provisions an org with the memory switch in the requested position (the
 * memory conformance suite's pattern). Organization id equals slug — the
 * tenancy-root addressing rule.
 */
async function createOrg(memoryEnabled: boolean): Promise<string> {
  orgCounter += 1;
  const org = await orgCommand.create({
    apiVersion: ORG_API_VERSION,
    kind: ORG_KIND,
    metadata: { name: `Memory Test Org ${orgCounter}` },
    spec: { preferences: { memoryEnabled } },
  });
  return org.metadata!.slug;
}

let memoryCounter = 0;
async function createMemory(org: string, content?: string): Promise<Memory> {
  memoryCounter += 1;
  return command.create({
    apiVersion: MEMORY_API_VERSION,
    kind: MEMORY_KIND,
    metadata: { org },
    spec: { content: content ?? `Remembered fact ${memoryCounter}.` },
  });
}

async function grpcError(run: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await run();
    throw new Error("expected the call to fail");
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
}

describe("memory create", () => {
  it("starts proposed with state_changed_at set and server-writes every owned field", async () => {
    const org = await createOrg(true);
    // Forge the server-owned fields; all of them must come back
    // server-written.
    const created = await command.create({
      apiVersion: MEMORY_API_VERSION,
      kind: MEMORY_KIND,
      metadata: { org },
      spec: {
        content: "Deploys to us-east-1.",
        subjectIdentityAccountId: "ida_forged",
      },
      status: {
        lifecycleState: MemoryLifecycleState.lifecycle_state_confirmed,
      },
    });

    expect(created.metadata?.id).toMatch(/^mem_/);
    expect(created.spec?.content).toBe("Deploys to us-east-1.");
    expect(created.spec?.subjectIdentityAccountId).toBe("");
    expect(created.status?.lifecycleState).toBe(
      MemoryLifecycleState.lifecycle_state_proposed,
    );
    expect(created.status?.stateChangedAt).toBeDefined();
  });

  it("stores capture-path provenance with tool_call_id force-cleared", async () => {
    const org = await createOrg(true);
    const created = await command.create({
      apiVersion: MEMORY_API_VERSION,
      kind: MEMORY_KIND,
      metadata: { org },
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

    expect(created.spec?.provenance?.agentId).toBe("agt_1");
    expect(created.spec?.provenance?.sessionId).toBe("ses_1");
    expect(created.spec?.provenance?.agentExecutionId).toBe("aex_1");
    expect(created.spec?.provenance?.toolCallId ?? "").toBe("");
  });

  it("defaults an unnamed record's name from its own minted mem_ id", async () => {
    const org = await createOrg(true);
    const created = await createMemory(org);
    expect(created.metadata?.id).toMatch(/^mem_/);
    expect(created.metadata?.name).toBe(created.metadata?.id);
  });

  it("requires metadata.org with the exact InvalidArgument copy", async () => {
    const error = await grpcError(() =>
      command.create({
        apiVersion: MEMORY_API_VERSION,
        kind: MEMORY_KIND,
        metadata: { name: "Orgless Memory" },
        spec: { content: "A fact without a home." },
      }),
    );
    expect(error.code).toBe(Code.InvalidArgument);
    expect(error.rawMessage).toBe("metadata.org is required for a memory");
  });
});

describe("memory enablement (fail-closed)", () => {
  it("refuses a create while the org has memory disabled, with the exact formatted copy", async () => {
    const org = await createOrg(false);
    const error = await grpcError(() => createMemory(org));
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(memoryDisabledMessage(org));
  });

  it("answers NotFound for an unknown org — the check fails closed", async () => {
    const error = await grpcError(() => createMemory("no-such-org"));
    expect(error.code).toBe(Code.NotFound);
    expect(error.rawMessage).toBe("Organization not found: no-such-org");
  });
});

describe("memory cap", () => {
  it("refuses the record past the per-subject ceiling, visibly, without blocking other orgs", async () => {
    const org = await createOrg(true);
    const otherOrg = await createOrg(true);

    // Seed the ceiling directly through the store (the RPC path would be
    // needlessly slow at 100 creates); the refused create goes through
    // the RPC. Seeded rows carry the sentinel subject "" the create path
    // would derive.
    for (let i = 0; i < MAX_MEMORIES_PER_SUBJECT; i++) {
      const id = generateId("mem");
      const seeded = create(MemorySchema, {
        apiVersion: MEMORY_API_VERSION,
        kind: MEMORY_KIND,
        metadata: { id, name: id, slug: id, org },
        spec: { content: `Seeded fact ${i}.`, subjectIdentityAccountId: "" },
      });
      await server.store.saveResource(
        ApiResourceKind.memory,
        id,
        MemorySchema,
        seeded,
      );
    }

    const error = await grpcError(() => createMemory(org, "One too many."));
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(MEMORY_FULL_MESSAGE);

    // A different org's subject is not blocked by this org's ceiling.
    const unblocked = await createMemory(
      otherOrg,
      "Different org, plenty of room.",
    );
    expect(unblocked.metadata?.id).toMatch(/^mem_/);
  });
});

describe("memory confirm/reject", () => {
  it("confirms a proposal; re-confirm is an idempotent no-op with no audit bump", async () => {
    const org = await createOrg(true);
    const memory = await createMemory(org);
    const id = { value: memory.metadata!.id };

    const confirmed = await command.confirm(id);
    expect(confirmed.status?.lifecycleState).toBe(
      MemoryLifecycleState.lifecycle_state_confirmed,
    );

    // Idempotent no-op: same decision timestamp, same audit stamp — the
    // sentinel abort wrote nothing.
    const again = await command.confirm(id);
    expect(again.status?.lifecycleState).toBe(
      MemoryLifecycleState.lifecycle_state_confirmed,
    );
    expect(again.status?.stateChangedAt).toEqual(
      confirmed.status?.stateChangedAt,
    );
    expect(again.status?.audit?.statusAudit?.updatedAt).toEqual(
      confirmed.status?.audit?.statusAudit?.updatedAt,
    );
  });

  it("refuses reject-after-confirm with the pinned copy", async () => {
    const org = await createOrg(true);
    const memory = await createMemory(org);
    const id = { value: memory.metadata!.id };
    await command.confirm(id);

    const error = await grpcError(() => command.reject(id));
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(MEMORY_REJECT_CONFIRMED_MESSAGE);
  });

  it("rejects a proposal idempotently and refuses confirm-after-reject with the pinned copy", async () => {
    const org = await createOrg(true);
    const memory = await createMemory(org);
    const id = { value: memory.metadata!.id };

    const rejected = await command.reject(id);
    expect(rejected.status?.lifecycleState).toBe(
      MemoryLifecycleState.lifecycle_state_rejected,
    );

    const again = await command.reject(id);
    expect(again.status?.stateChangedAt).toEqual(
      rejected.status?.stateChangedAt,
    );

    const error = await grpcError(() => command.confirm(id));
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(MEMORY_CONFIRM_REJECTED_MESSAGE);
  });

  it("answers NotFound for an unknown id", async () => {
    const ghost = { value: "mem_00000000000000000000000000" };
    for (const run of [
      () => command.confirm(ghost),
      () => command.reject(ghost),
    ]) {
      const error = await grpcError(run);
      expect(error.code).toBe(Code.NotFound);
    }
  });
});

describe("memory update", () => {
  function updateInput(
    memory: Memory,
    spec: MessageInitShape<typeof MemorySchema>["spec"],
  ): MessageInitShape<typeof MemorySchema> {
    return {
      apiVersion: memory.apiVersion,
      kind: memory.kind,
      metadata: memory.metadata,
      spec,
    };
  }

  it("edits content and answers with the LIVE lifecycle — the graft pin", async () => {
    const org = await createOrg(true);
    const memory = await createMemory(org);
    const id = memory.metadata!.id;
    await command.confirm({ value: id });

    // A wholesale spec replacement editing content only (status wiped, as
    // generated update mappers send it): the decision must survive by
    // mechanism, in the response AND the stored row.
    const updated = await command.update(
      updateInput(memory, {
        content: "Deploys to eu-west-1.",
        subjectIdentityAccountId: memory.spec!.subjectIdentityAccountId,
        provenance: memory.spec!.provenance,
      }),
    );
    expect(updated.spec?.content).toBe("Deploys to eu-west-1.");
    expect(updated.status?.lifecycleState).toBe(
      MemoryLifecycleState.lifecycle_state_confirmed,
    );

    const stored = await query.get({ value: id });
    expect(stored.spec?.content).toBe("Deploys to eu-west-1.");
    expect(stored.status?.lifecycleState).toBe(
      MemoryLifecycleState.lifecycle_state_confirmed,
    );
  });

  it("refuses a subject change with the pinned copy", async () => {
    const org = await createOrg(true);
    const memory = await createMemory(org);

    const error = await grpcError(() =>
      command.update(
        updateInput(memory, {
          content: "x",
          subjectIdentityAccountId: "ida_someone_else",
        }),
      ),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(MEMORY_SUBJECT_IMMUTABLE_MESSAGE);
  });

  it("refuses a provenance change with the pinned copy", async () => {
    const org = await createOrg(true);
    const memory = await createMemory(org);

    const error = await grpcError(() =>
      command.update(
        updateInput(memory, {
          content: "x",
          subjectIdentityAccountId: memory.spec!.subjectIdentityAccountId,
          provenance: { agentId: "agt_invented" },
        }),
      ),
    );
    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toBe(MEMORY_PROVENANCE_IMMUTABLE_MESSAGE);
  });

  it("ignores a client-sent lifecycle on update — consent is not rewritable through a spec edit", async () => {
    const org = await createOrg(true);
    const memory = await createMemory(org);
    const id = memory.metadata!.id;
    await command.confirm({ value: id });

    const updated = await command.update({
      apiVersion: memory.apiVersion,
      kind: memory.kind,
      metadata: memory.metadata,
      spec: {
        content: "Still the subject's fact.",
        subjectIdentityAccountId: memory.spec!.subjectIdentityAccountId,
      },
      status: {
        lifecycleState: MemoryLifecycleState.lifecycle_state_rejected,
      },
    });
    expect(updated.status?.lifecycleState).toBe(
      MemoryLifecycleState.lifecycle_state_confirmed,
    );

    const stored = await query.get({ value: id });
    expect(stored.status?.lifecycleState).toBe(
      MemoryLifecycleState.lifecycle_state_confirmed,
    );
  });
});

describe("memory delete", () => {
  it("works from proposed, confirmed, and rejected states — never refused on lifecycle grounds", async () => {
    const org = await createOrg(true);

    const proposed = await createMemory(org, "Proposed fact.");
    const confirmed = await createMemory(org, "Confirmed fact.");
    await command.confirm({ value: confirmed.metadata!.id });
    const rejected = await createMemory(org, "Rejected fact.");
    await command.reject({ value: rejected.metadata!.id });

    for (const record of [proposed, confirmed, rejected]) {
      const id = { value: record.metadata!.id };
      const deleted = await command.delete(id);
      expect(deleted.metadata?.id).toBe(record.metadata?.id);

      const error = await grpcError(() => query.get(id));
      expect(error.code).toBe(Code.NotFound);
    }
  });
});

describe("memory list", () => {
  it("is org-scoped", async () => {
    const org = await createOrg(true);
    const other = await createOrg(true);
    const mine = await createMemory(org, "First fact.");
    await createMemory(other, "Another org's fact.");

    const listed = await query.list({ org });
    expect(listed.totalCount).toBe(listed.items.length);
    expect(listed.items.map((m) => m.metadata?.id)).toContain(
      mine.metadata?.id,
    );
    for (const item of listed.items) {
      expect(item.metadata?.org).toBe(org);
    }
  });
});
