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
 *   - an update that loses its write to an edit made after its read reads
 *     again and compares its etag with that row, so it ends refused with
 *     ETAG_MISMATCH, never merged onto the edit;
 *   - a create, and an apply that creates, store the etag of what they
 *     wrote, never one the client sent;
 *   - what the platform writes (a visibility change) leaves the etag as
 *     it was, so an editor's save never conflicts with it;
 *   - a read whose values are hidden (a vault's secrets) saves with its
 *     etag: the etag is the stored row's, never the redacted answer's;
 *   - a mask naming a path the kind does not have, or one another door
 *     owns, is refused with INVALID_ARGUMENT naming it;
 *   - an update without the id is refused before anything is read;
 *   - an update that names neither its secrets nor its provider keeps
 *     them: the sealed values it merges onto are the stored ones, never
 *     refused as forged ciphertext (an OAuth app, a channel app);
 *   - an apply of an existing resource is an update naming every path
 *     (an OAuth app, a session);
 *   - the runner's harness door is served, and refuses a person.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import { ChannelAppSchema } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/api_pb";
import { ChannelAppCommandController } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/command_pb";
import { SessionCommandController } from "@stigmer/apis/ai/stigmer/agentic/session/v1/command_pb";
import { VaultCommandController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/command_pb";
import { VaultQueryController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/query_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { OAuthAppSchema } from "@stigmer/apis/ai/stigmer/iam/oauthapp/v1/api_pb";
import { OAuthAppCommandController } from "@stigmer/apis/ai/stigmer/iam/oauthapp/v1/command_pb";
import { ErrorInfoSchema } from "@stigmer/apis/google/rpc/error_details_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import { seedOrganizations } from "../../domain/organization/__tests__/support.js";
import { baseConfig, silentLogger } from "../../extensions/__tests__/composed-support.js";
import { ETAG_MISMATCH_REASON } from "../guarded-write.js";
import { writeLandsMidUpdate } from "./race-support.js";

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
  const oauthApps = () => createClient(OAuthAppCommandController, wire);
  const channelApps = () => createClient(ChannelAppCommandController, wire);
  const sessions = () => createClient(SessionCommandController, wire);

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "update-contract-"));
    // Secrets are sealed, so a merged row carries ciphertext.
    vi.stubEnv("STIGMER_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
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
    vi.unstubAllEnvs();
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

  it("re-checks the etag on the attempt after a lost write, so an edit landing mid-update refuses it", async () => {
    const created = await agents().create(agentInput("etag-retry"));
    const id = created.metadata!.id;
    const read = await agentQuery().get({ value: id });

    // The edit lands when the update first writes, after its read.
    const error = await grpcError(() =>
      writeLandsMidUpdate(
        server.store,
        ApiResourceKind.agent,
        id,
        () =>
          server.store.updateResource(ApiResourceKind.agent, id, AgentSchema, (row) => {
            row.spec!.description = "the teammate's words";
          }),
        () =>
          agents().update({
            resource: { metadata: { id, etag: read.metadata!.etag }, spec: { instructions: "review only the drafts, please" } },
            updateMask: { paths: ["spec.instructions"] },
          }),
      ),
    );
    expect(error.code).toBe(Code.Aborted);
    expect(error.findDetails(ErrorInfoSchema)[0]?.reason).toBe(ETAG_MISMATCH_REASON);
    const stored = await server.store.getResource(ApiResourceKind.agent, id, AgentSchema);
    expect([stored.spec?.description, stored.spec?.instructions]).toEqual([
      "the teammate's words",
      "help the people of this test",
    ]);
  });

  it("stores the etag of what a create, or an apply that creates, wrote; never one the client sent", async () => {
    const forged = "f".repeat(64);
    const created = await agents().create({ ...agentInput("etag-create"), metadata: { ...agentInput("etag-create").metadata, etag: forged } });
    const applied = await agents().apply({ ...agentInput("etag-apply"), metadata: { ...agentInput("etag-apply").metadata, etag: forged } });
    for (const answer of [created, applied]) {
      const stored = await server.store.getResource(ApiResourceKind.agent, answer.metadata!.id, AgentSchema);
      expect(answer.metadata?.etag).not.toBe(forged);
      expect(answer.metadata?.etag).toBe(stored.metadata?.etag);
    }
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

  it("keeps the sealed secrets and the provider of an update that names neither", async () => {
    const app = await oauthApps().create({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "OAuthApp",
      metadata: { name: "Vendor login", org: ORG },
      spec: {
        provider: "Vendor",
        clientId: "vendor-client-id",
        clientSecret: "vendor-client-secret",
        authorizationUrl: "https://vendor.example.com/oauth/authorize",
        tokenUrl: "https://vendor.example.com/oauth/token",
        addresses: ["https://mcp.vendor.example.com/mcp"],
      },
    });
    const sealed = (await server.store.getResource(ApiResourceKind.oauth_app, app.metadata!.id, OAuthAppSchema)).spec
      ?.clientSecret;
    expect(sealed).toMatch(/^enc:/);
    const renamed = await oauthApps().update({
      resource: { metadata: { id: app.metadata!.id, name: "Vendor sign-in" } },
      updateMask: { paths: ["metadata.name"] },
    });
    expect(renamed.metadata?.name).toBe("Vendor sign-in");
    const storedApp = await server.store.getResource(ApiResourceKind.oauth_app, app.metadata!.id, OAuthAppSchema);
    expect(storedApp.spec?.clientSecret).toBe(sealed);

    const channelApp = await channelApps().create({
      apiVersion: AGENTIC,
      kind: "ChannelApp",
      metadata: { name: "Team Slack", org: ORG },
      spec: {
        providerConfig: {
          case: "slack",
          value: { clientId: "slack-client-id", clientSecret: "slack-client-secret", signingSecret: "slack-signing-secret" },
        },
      },
    });
    const storedBefore = await server.store.getResource(ApiResourceKind.channel_app, channelApp.metadata!.id, ChannelAppSchema);
    const updated = await channelApps().update({
      resource: { metadata: { id: channelApp.metadata!.id, name: "Team Slack app" } },
      updateMask: { paths: ["metadata.name"] },
    });
    expect(updated.metadata?.name).toBe("Team Slack app");
    const storedAfter = await server.store.getResource(ApiResourceKind.channel_app, channelApp.metadata!.id, ChannelAppSchema);
    expect(storedAfter.spec?.providerConfig).toEqual(storedBefore.spec?.providerConfig);
  });

  it("applies an existing OAuth app and session as an update naming every path", async () => {
    const appInput = {
      apiVersion: "iam.stigmer.ai/v1",
      kind: "OAuthApp",
      metadata: { name: "Applied login", org: ORG },
      spec: {
        provider: "Vendor",
        clientId: "applied-client-id",
        clientSecret: "applied-client-secret",
        authorizationUrl: "https://applied.example.com/oauth/authorize",
        tokenUrl: "https://applied.example.com/oauth/token",
        addresses: ["https://mcp.applied.example.com/mcp"],
      },
    };
    const app = await oauthApps().apply(appInput);
    const reapplied = await oauthApps().apply({ ...appInput, spec: { ...appInput.spec, provider: "Vendor Two" } });
    expect(reapplied.metadata?.id).toBe(app.metadata?.id);
    expect(reapplied.spec?.provider).toBe("Vendor Two");

    const sessionInput = {
      apiVersion: AGENTIC,
      kind: "Session",
      metadata: { name: "Applied chat", org: ORG },
      spec: { subject: "First words" },
    };
    const session = await sessions().apply(sessionInput);
    const again = await sessions().apply({
      ...sessionInput,
      metadata: { ...sessionInput.metadata, slug: session.metadata!.slug },
      spec: { subject: "Second words" },
    });
    expect(again.metadata?.id).toBe(session.metadata?.id);
    expect(again.spec?.subject).toBe("Second words");
  });

  it("serves the runner's harness door, which refuses a person", async () => {
    const refused = await grpcError(() =>
      sessions().bindHarnessState({ runId: "run_01notarunner", harnessStateId: "thread-forged" }),
    );
    expect(refused.code).toBe(Code.PermissionDenied);
    expect(refused.rawMessage).toBe("only the runner acting for this run may record its session's harness state");
  });
});
