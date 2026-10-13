/**
 * Pins the update contract through a composed server (agent and vault
 * chains, over the wire):
 *
 *   - an update changes only the paths its mask names, so a teammate's
 *     change to another field, made after this update's read, stays;
 *   - an update or an apply carrying the etag it read is refused with
 *     ABORTED ETAG_MISMATCH once the resource changed, writing nothing;
 *     with the current etag it lands, and the answer carries the new one,
 *     which is the stored row's; without an etag, last write wins on what
 *     it names;
 *   - what the platform writes (a visibility change) leaves the etag as
 *     it was, so an editor's save never conflicts with it;
 *   - a read whose values are hidden (a vault's secrets) saves with its
 *     etag: the etag is the stored row's, never the redacted answer's;
 *   - a mask naming a path the kind does not have, or one another door
 *     owns, is refused with INVALID_ARGUMENT naming it;
 *   - an update without the id is refused before anything is read.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import { seedOrganizations } from "../../domain/organization/__tests__/support.js";
import { baseConfig, silentLogger } from "../../extensions/__tests__/composed-support.js";
import { ETAG_MISMATCH_REASON } from "../guarded-write.js";

const ORG = "update-contract";
const AGENTIC = "agentic.stigmer.ai/v1";

async function grpcError(run: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected the call to fail");
}

function agentInput(slug: string) {
  return {
    apiVersion: AGENTIC,
    kind: "Agent",
    metadata: { name: slug, org: ORG, slug },
    spec: { instructions: "help the people of this test", description: "first words" },
  };
}

describe("the update contract, through a composed server", () => {
  let dir: string;
  let server: ComposedServer;
  let wire: Transport;

  const agents = () => createClient(AgentCommandController, wire);
  const agentQuery = () => createClient(AgentQueryController, wire);
  const vaults = () => createClient(VaultCommandController, wire);
  const vaultQuery = () => createClient(VaultQueryController, wire);

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "update-contract-"));
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    wire = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
    await seedOrganizations(wire, [ORG]);
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("changes only what its mask names: a teammate's change made after the read stays", async () => {
    const created = await agents().create(agentInput("partial"));
    const id = created.metadata!.id;
    const read = await agentQuery().get({ value: id });

    // A teammate changes the description.
    await agents().update({
      resource: { metadata: { id }, spec: { description: "the teammate's words" } },
      updateMask: { paths: ["spec.description"] },
    });

    // The editor, from its earlier read, sends no etag and names the instructions.
    const edited = await agents().update({
      resource: {
        ...read,
        metadata: { ...read.metadata!, etag: "" },
        spec: { ...read.spec!, instructions: "review only the drafts, please" },
      },
      updateMask: { paths: ["spec.instructions"] },
    });
    expect(edited.spec?.instructions).toBe("review only the drafts, please");
    expect(edited.spec?.description).toBe("the teammate's words");
    const stored = await server.store.getResource(ApiResourceKind.agent, id, AgentSchema);
    expect(stored.spec?.description).toBe("the teammate's words");
  });

  it("refuses an update carrying a stale etag, writing nothing; the current etag lands and the answer carries the new one", async () => {
    const created = await agents().create(agentInput("etag"));
    const id = created.metadata!.id;
    const read = await agentQuery().get({ value: id });
    expect(read.metadata?.etag).toMatch(/^[0-9a-f]{64}$/);

    const teammate = await agents().update({
      resource: { metadata: { id, etag: read.metadata!.etag }, spec: { description: "the teammate's words" } },
      updateMask: { paths: ["spec.description"] },
    });
    expect(teammate.metadata?.etag).not.toBe(read.metadata?.etag);

    const stale = await grpcError(() =>
      agents().update({
        resource: { ...read, spec: { ...read.spec!, instructions: "review only the drafts, please" } },
        updateMask: { paths: ["spec.instructions"] },
      }),
    );
    expect(stale.code).toBe(Code.Aborted);
    expect(stale.rawMessage).toMatch(/^Agent '.+\/etag' changed since you read it; reload it and make your change again$/);
    expect(stale.findDetails(ErrorInfoSchema)[0]?.reason).toBe(ETAG_MISMATCH_REASON);
    const untouched = await server.store.getResource(ApiResourceKind.agent, id, AgentSchema);
    expect(untouched.spec?.instructions).toBe("help the people of this test");

    const current = await agents().update({
      resource: {
        metadata: { id, etag: teammate.metadata!.etag },
        spec: { instructions: "review only the drafts, please" },
      },
      updateMask: { paths: ["spec.instructions"] },
    });
    expect(current.spec?.instructions).toBe("review only the drafts, please");
    expect(current.metadata?.etag).not.toBe(teammate.metadata?.etag);
    const stored = await server.store.getResource(ApiResourceKind.agent, id, AgentSchema);
    expect(current.metadata?.etag).toBe(stored.metadata?.etag);
  });

  it("refuses an apply carrying a stale etag; one with none wins", async () => {
    const created = await agents().create(agentInput("apply-etag"));
    const id = created.metadata!.id;
    const read = await agentQuery().get({ value: id });
    await agents().update({
      resource: { metadata: { id }, spec: { description: "the teammate's words" } },
      updateMask: { paths: ["spec.description"] },
    });

    const stale = await grpcError(() => agents().apply({ ...read, spec: { ...read.spec!, description: "the file's words" } }));
    expect(stale.code).toBe(Code.Aborted);
    expect(stale.findDetails(ErrorInfoSchema)[0]?.reason).toBe(ETAG_MISMATCH_REASON);

    const applied = await agents().apply({
      ...read,
      metadata: { ...read.metadata!, etag: "" },
      spec: { ...read.spec!, description: "the file's words" },
    });
    expect(applied.spec?.description).toBe("the file's words");
  });

  it("leaves the etag as it was when the platform writes (a visibility change)", async () => {
    const created = await agents().create(agentInput("visibility"));
    const id = created.metadata!.id;
    const before = (await agentQuery().get({ value: id })).metadata?.etag;
    await agents().updateVisibility({ resourceId: id, visibility: ApiResourceVisibility.visibility_org });
    const after = await agentQuery().get({ value: id });
    expect(after.metadata?.visibility).toBe(ApiResourceVisibility.visibility_org);
    expect(after.metadata?.etag).toBe(before);
  });

  it("saves a read whose values are hidden with its etag", async () => {
    const created = await vaults().create({
      apiVersion: AGENTIC,
      kind: "Vault",
      metadata: { name: "Hidden values", org: ORG },
    });
    const id = created.metadata!.id;
    await vaults().setSecrets({
      vault: { org: ORG, vault: { case: "id", value: id } },
      secrets: { API_KEY: { value: "sk-hidden", description: "" } },
    });
    const read = await vaultQuery().get({ value: id });
    expect(read.spec?.secrets.API_KEY?.value ?? "").not.toBe("sk-hidden");

    const saved = await vaults().update({
      resource: { ...read, spec: { ...read.spec!, description: "edited with its etag" } },
      updateMask: { paths: ["spec.description"] },
    });
    expect(saved.spec?.description).toBe("edited with its etag");
    expect(Object.keys(saved.spec?.secrets ?? {})).toEqual(["API_KEY"]);
  });

  it("refuses a mask naming a path the kind does not have, or one another door owns, naming it", async () => {
    const agent = await agents().create(agentInput("bad-path"));
    const unknown = await grpcError(() =>
      agents().update({
        resource: { metadata: { id: agent.metadata!.id } },
        updateMask: { paths: ["spec.no_such_field"] },
      }),
    );
    expect(unknown.code).toBe(Code.InvalidArgument);
    expect(unknown.rawMessage).toBe("update_mask path 'spec.no_such_field' is not a field of Agent");

    const vault = await vaults().create({
      apiVersion: AGENTIC,
      kind: "Vault",
      metadata: { name: "Door owned", org: ORG },
    });
    const owned = await grpcError(() =>
      vaults().update({
        resource: { metadata: { id: vault.metadata!.id } },
        updateMask: { paths: ["spec.secrets"] },
      }),
    );
    expect(owned.code).toBe(Code.InvalidArgument);
    expect(owned.rawMessage).toBe(
      "update_mask path 'spec.secrets' is written by setSecrets and removeSecrets, not by update",
    );
  });

  it("refuses an update without the id, and one without a mask", async () => {
    await agents().create(agentInput("no-id"));
    const noId = await grpcError(() =>
      agents().update({ resource: agentInput("no-id"), updateMask: { paths: ["*"] } }),
    );
    expect(noId.code).toBe(Code.InvalidArgument);
    expect(noId.rawMessage).toContain("resource.metadata.id is required");

    const created = await agents().create(agentInput("no-mask"));
    const noMask = await grpcError(() =>
      agents().update({ resource: { metadata: { id: created.metadata!.id } } }),
    );
    expect(noMask.code).toBe(Code.InvalidArgument);
    expect(noMask.rawMessage).toContain("update_mask");
  });
});
