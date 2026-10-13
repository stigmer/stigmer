/**
 * Pins renames (rename.ts, names.ts findResourceForWrite) through a
 * composed server in the trusted-local posture:
 *
 *   - a rename keeps the id, moves the name, stamps the spec audit, and the
 *     old slug leads to the resource for reading; a rename to the current
 *     slug changes nothing; a slug another resource holds is refused;
 *   - a create of the old slug is refused with SLUG_RESERVED, and the
 *     resource takes it back;
 *   - a write naming the old slug without the id is refused with
 *     SLUG_RENAMED, whose words never name the new slug; once the hold ends
 *     the old slug resolves nowhere, for reads and writes alike;
 *   - an apply carrying the id finds the resource by it and leaves the slug
 *     to rename, and one copied into another organization makes its own;
 *   - a name whose holder is gone is taken by a rename; a failed row write
 *     moves the names back;
 *   - My vault and a system-managed platform client refuse a rename, and a
 *     rename reaches no slug their creates refuse;
 *   - an archived version read back names its resource by its current slug;
 *   - every other writer of a renamable kind keeps a rename that lands
 *     between its load and its write: the row and the table agree on the
 *     new slug, and the writer's own change lands too (an update loses its
 *     compare-and-swap to the rename and runs again from a fresh read);
 *   - a writer whose row is deleted between its load and its write answers
 *     NotFound rather than writing it back (the agent's visibility, the
 *     platform client's update, whose lost swap reads again and finds no
 *     row, and its rotation, an organization's rename);
 *   - a platform client's create of a renamed-away slug is SLUG_RESERVED.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { DescMessage, MessageShape } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { ChannelAppSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { ChannelAppCommandController } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/command_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { ScheduleCommandController } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/command_pb";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { OAuthAppCommandController } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/command_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { PlatformClientCommandController } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/command_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { seedOrganizations } from "../../../domain/organization/__tests__/support.js";
import type { OrganizationIds } from "../../../domain/organization/__tests__/support.js";
import {
  baseConfig,
  silentLogger,
} from "../../../extensions/__tests__/composed-support.js";
import { SYSTEM_MANAGED_LABEL } from "../../apiresource-labels.js";
import { kindEnumName } from "../../apiresource-meta.js";
import {
  ABANDONED_NAME_AFTER_MS,
  SLUG_RENAMED,
  SLUG_RESERVED,
  findResourceByName,
  findResourceForWrite,
  resourceNameKey,
  storedRowReader,
} from "../names.js";
import { RENAMED_NAME_HOLD_MS } from "../rename.js";

const ORG = "renames";
const OTHER = "renames-elsewhere";
const AGENTIC = "agentic.stigmer.ai/v1";
const IAM = "iam.stigmer.ai/v1";

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

function reasonOf(error: ConnectError) {
  return error.findDetails(ErrorInfoSchema)[0];
}

function agentInput(
  org: string,
  slug: string,
  instructions = "help the people of this test",
) {
  return {
    apiVersion: AGENTIC,
    kind: "Agent",
    metadata: { name: slug, org, slug },
    spec: { instructions },
  };
}

describe("renames, through a composed server", () => {
  let dir: string;
  let server: ComposedServer;
  let wire: Transport;
  let orgs: OrganizationIds;

  const agents = () => createClient(AgentCommandController, wire);
  const agentQuery = () => createClient(AgentQueryController, wire);
  const vaults = () => createClient(VaultCommandController, wire);
  const vaultQuery = () => createClient(VaultQueryController, wire);
  const schedules = () => createClient(ScheduleCommandController, wire);
  const channelApps = () => createClient(ChannelAppCommandController, wire);
  const oauthApps = () => createClient(OAuthAppCommandController, wire);
  const platformClients = () =>
    createClient(PlatformClientCommandController, wire);
  const orgId = (slug: string) => orgs.get(slug) ?? "";

  /** The kind's current name for `id`, from the table. */
  const currentName = async (kind: ApiResourceKind, org: string, id: string) =>
    (await server.store.resourceNames.current(kindEnumName(kind), org, id))
      ?.name;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "renames-"));
    server = await composeServer({
      config: loadConfig(baseConfig(dir)),
      logger: silentLogger,
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    wire = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
    orgs = await seedOrganizations(wire, [ORG, OTHER]);
  });

  afterAll(async () => {
    await server.shutdown();
    rmSync(dir, { recursive: true, force: true });
  });

  it("a rename keeps the id, moves the name and stamps the spec audit, and the old slug leads to the agent for reading", async () => {
    const created = await agents().create(agentInput(ORG, "rename-keeps"));
    const id = created.metadata!.id;

    const renamed = await agents().rename({
      resourceId: id,
      slug: "rename-kept",
    });
    expect(renamed.metadata?.id).toBe(id);
    expect(renamed.metadata?.slug).toBe("rename-kept");
    expect(renamed.status?.audit?.specAudit?.event).toBe("renamed");
    expect(renamed.spec?.instructions, "a rename writes the slug alone").toBe(
      "help the people of this test",
    );

    const byOld = await agentQuery().getByReference({
      org: ORG,
      slug: "rename-keeps",
    });
    expect(byOld.metadata?.id).toBe(id);
    expect(
      byOld.metadata?.slug,
      "the old slug answers the resource by its new slug",
    ).toBe("rename-kept");
    expect(await currentName(ApiResourceKind.agent, orgId(ORG), id)).toBe(
      "rename-kept",
    );

    const held = await server.store.resourceNames.resolve(
      resourceNameKey(ApiResourceKind.agent, orgId(ORG), "rename-keeps"),
      new Date().toISOString(),
    );
    expect(held?.state).toBe("previous");
    const holdMs = Date.parse(held!.expiresAt) - Date.now();
    expect(holdMs).toBeGreaterThan(RENAMED_NAME_HOLD_MS - 60_000);
    expect(holdMs).toBeLessThanOrEqual(RENAMED_NAME_HOLD_MS);

    const again = await agents().rename({
      resourceId: id,
      slug: "rename-kept",
    });
    expect(
      again.metadata?.slug,
      "a rename to the current slug changes nothing",
    ).toBe("rename-kept");
    expect(again.status?.audit?.specAudit?.updatedAt).toEqual(
      renamed.status?.audit?.specAudit?.updatedAt,
    );
  });

  it("a create of a renamed-away slug is refused with SLUG_RESERVED, and the resource takes the slug back", async () => {
    const created = await agents().create(agentInput(ORG, "reserved-old"));
    const id = created.metadata!.id;
    await agents().rename({ resourceId: id, slug: "reserved-new" });

    const refused = await grpcError(() =>
      agents().create(agentInput(ORG, "reserved-old")),
    );
    expect(refused.code).toBe(Code.AlreadyExists);
    expect(refused.rawMessage).toBe(
      "Agent slug 'reserved-old' was recently another agent's, and still leads to it",
    );
    expect(reasonOf(refused)?.reason).toBe(SLUG_RESERVED);
    expect(reasonOf(refused)?.metadata).toEqual({ slug: "reserved-old" });

    const other = await agents().create(agentInput(ORG, "reserved-other"));
    const onto = await grpcError(() =>
      agents().rename({ resourceId: other.metadata!.id, slug: "reserved-old" }),
    );
    expect(onto.code).toBe(Code.AlreadyExists);
    expect(reasonOf(onto)?.reason).toBe(SLUG_RESERVED);
    const ontoCurrent = await grpcError(() =>
      agents().rename({ resourceId: other.metadata!.id, slug: "reserved-new" }),
    );
    expect(ontoCurrent.code).toBe(Code.AlreadyExists);
    expect(
      reasonOf(ontoCurrent),
      "another's current slug keeps the duplicate copy",
    ).toBeUndefined();

    const back = await agents().rename({
      resourceId: id,
      slug: "reserved-old",
    });
    expect(back.metadata?.slug).toBe("reserved-old");

    // In another organization the slug was never held.
    const elsewhere = await agents().create(agentInput(OTHER, "reserved-new"));
    expect(elsewhere.metadata?.slug).toBe("reserved-new");
  });

  it("an apply naming a renamed-away slug without the id is refused with SLUG_RENAMED, whose words never name the new slug; an update needs the id", async () => {
    const created = await agents().create(agentInput(ORG, "stale-file"));
    const id = created.metadata!.id;
    await agents().rename({ resourceId: id, slug: "fresh-name" });

    const refused = await grpcError(() =>
      agents().apply(agentInput(ORG, "stale-file", "changed by a stale file")),
    );
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe(
      "Agent 'stale-file' was renamed; it still leads to the same agent for reading. Write to it by its current slug or its id",
    );
    expect(refused.rawMessage).not.toContain("fresh-name");
    expect(reasonOf(refused)?.reason).toBe(SLUG_RENAMED);
    expect(reasonOf(refused)?.metadata).toEqual({ slug: "stale-file" });

    // An update names its target by id; by slug alone it is refused before
    // the slug is read.
    const noId = await grpcError(() =>
      agents().update({
        resource: agentInput(ORG, "stale-file", "changed by a stale file"),
        updateMask: { paths: ["*"] },
      }),
    );
    expect(noId.code).toBe(Code.InvalidArgument);
    expect(noId.rawMessage).toContain("resource.metadata.id is required");
    const stored = await server.store.getResource(
      ApiResourceKind.agent,
      id,
      AgentSchema,
    );
    expect(stored.spec?.instructions, "nothing was written").toBe(
      "help the people of this test",
    );

    // By its current slug, or by its id, the write lands.
    const applied = await agents().apply(
      agentInput(ORG, "fresh-name", "changed by a fresh file"),
    );
    expect(applied.metadata?.id).toBe(id);
    const byId = await agents().update({ resource: {
      ...agentInput(ORG, "stale-file", "changed by id"),
      metadata: { id, org: ORG, name: "x", slug: "stale-file" },
    }, updateMask: { paths: ["*"] } });
    expect(byId.metadata?.slug, "an update by id keeps the slug").toBe(
      "fresh-name",
    );
    expect(byId.spec?.instructions).toBe("changed by id");
  });

  it("once the hold ends, the old slug resolves nowhere, for a read and for a write", async () => {
    const created = await agents().create(agentInput(ORG, "hold-ends"));
    const id = created.metadata!.id;
    await agents().rename({ resourceId: id, slug: "hold-ended" });
    const org = orgId(ORG);
    const reader = storedRowReader(
      server.store,
      ApiResourceKind.agent,
      AgentSchema,
    );

    const during = new Date(Date.now() + RENAMED_NAME_HOLD_MS - 60_000);
    expect(
      (
        await findResourceByName(
          server.store,
          ApiResourceKind.agent,
          AgentSchema,
          org,
          "hold-ends",
          during,
        )
      )?.metadata?.id,
    ).toBe(id);
    const refused = await grpcError(() =>
      findResourceForWrite<typeof AgentSchema>(
        server.store,
        ApiResourceKind.agent,
        { id: "", org, slug: "hold-ends" },
        reader,
        during,
      ),
    );
    expect(reasonOf(refused)?.reason).toBe(SLUG_RENAMED);

    const after = new Date(Date.now() + RENAMED_NAME_HOLD_MS + 60_000);
    expect(
      await findResourceByName(
        server.store,
        ApiResourceKind.agent,
        AgentSchema,
        org,
        "hold-ends",
        after,
      ),
    ).toBeUndefined();
    expect(
      await findResourceForWrite<typeof AgentSchema>(
        server.store,
        ApiResourceKind.agent,
        { id: "", org, slug: "hold-ends" },
        reader,
        after,
      ),
      "a write by the released slug finds nothing: its create makes a new resource",
    ).toBeUndefined();
    expect(
      (
        await findResourceForWrite<typeof AgentSchema>(
          server.store,
          ApiResourceKind.agent,
          { id, org, slug: "hold-ends" },
          reader,
          after,
        )
      )?.metadata?.id,
      "the id still finds it",
    ).toBe(id);
  });

  it("an apply carrying the id finds the resource by it and leaves the slug to rename; the same file in another organization makes its own", async () => {
    const created = await agents().create(agentInput(ORG, "by-id"));
    const id = created.metadata!.id;
    const exported = {
      ...agentInput(ORG, "by-id-edited", "edited after export"),
      metadata: { id, org: ORG, name: "by-id", slug: "by-id-edited" },
    };

    const applied = await agents().apply(exported);
    expect(applied.metadata?.id, "found by id, not copied").toBe(id);
    expect(applied.metadata?.slug, "the slug changes only through rename").toBe(
      "by-id",
    );
    expect(applied.spec?.instructions).toBe("edited after export");

    const copied = await agents().apply({
      ...exported,
      metadata: { ...exported.metadata, org: OTHER },
    });
    expect(
      copied.metadata?.id,
      "another organization's row is passed over",
    ).not.toBe(id);
    expect(copied.metadata?.org).toBe(orgId(OTHER));
    expect(copied.metadata?.slug).toBe("by-id-edited");
    const source = await server.store.getResource(
      ApiResourceKind.agent,
      id,
      AgentSchema,
    );
    expect(
      source.spec?.instructions,
      "the source organization's agent is untouched",
    ).toBe("edited after export");
  });

  it("a rename takes a name whose holder is gone", async () => {
    const created = await agents().create(agentInput(ORG, "gone-holder-a"));
    const org = orgId(ORG);
    const old = new Date(
      Date.now() - ABANDONED_NAME_AFTER_MS - 1_000,
    ).toISOString();
    const claim = await server.store.resourceNames.claim(
      resourceNameKey(ApiResourceKind.agent, org, "gone-holder-b"),
      "agt_01gonegonegonegonegonegone",
      old,
    );
    expect(claim.claimed).toBe(true);

    const renamed = await agents().rename({
      resourceId: created.metadata!.id,
      slug: "gone-holder-b",
    });
    expect(renamed.metadata?.slug).toBe("gone-holder-b");
  });

  it("a rename whose row write fails moves the names back", async () => {
    const created = await agents().create(agentInput(ORG, "write-fails"));
    const id = created.metadata!.id;
    const spy = vi
      .spyOn(server.store, "updateResource")
      .mockRejectedValueOnce(new Error("disk full"));
    try {
      const failed = await grpcError(() =>
        agents().rename({ resourceId: id, slug: "write-failed" }),
      );
      expect(failed.code).toBe(Code.Internal);
    } finally {
      spy.mockRestore();
    }
    expect(await currentName(ApiResourceKind.agent, orgId(ORG), id)).toBe(
      "write-fails",
    );
    const again = await agents().create(agentInput(ORG, "write-failed"));
    expect(again.metadata?.slug, "the new slug was let go").toBe(
      "write-failed",
    );
  });

  it("an unknown resource is NotFound, naming the id", async () => {
    const missing = await grpcError(() =>
      agents().rename({
        resourceId: "agt_01nonenonenonenonenonenone",
        slug: "anything",
      }),
    );
    expect(missing.code).toBe(Code.NotFound);
    expect(missing.rawMessage).toBe(
      "Agent not found: agt_01nonenonenonenonenonenone",
    );
  });

  it("My vault refuses a rename, and no shared vault takes My vault's prefix", async () => {
    const mine = await vaults().setSecrets({
      vault: { org: ORG, vault: { case: "mine", value: true } },
      secrets: { TOKEN: { value: "x" } },
    });
    const refused = await grpcError(() =>
      vaults().rename({ resourceId: mine.metadata!.id, slug: "my-own-name" }),
    );
    expect(refused.code).toBe(Code.InvalidArgument);
    expect(refused.rawMessage).toMatch(/My vault is named after its person/);

    const shared = await vaults().create({
      apiVersion: AGENTIC,
      kind: "Vault",
      metadata: { name: "team-keys", org: ORG },
      spec: { description: "shared" },
    });
    const prefixed = await grpcError(() =>
      vaults().rename({
        resourceId: shared.metadata!.id,
        slug: "my-vault-team",
      }),
    );
    expect(prefixed.code).toBe(Code.InvalidArgument);
    const renamed = await vaults().rename({
      resourceId: shared.metadata!.id,
      slug: "team-secrets",
    });
    expect(renamed.metadata?.slug).toBe("team-secrets");
    const read = await vaultQuery().getByReference({
      org: ORG,
      slug: "team-keys",
    });
    expect(read.metadata?.slug).toBe("team-secrets");
  });

  it("a system-managed platform client refuses a rename, and no client takes the reserved slug", async () => {
    const created = await platformClients().create({
      apiVersion: IAM,
      kind: "PlatformClient",
      metadata: { name: "embed", org: ORG },
      spec: {},
    });
    const id = created.platformClient!.metadata!.id;
    const reserved = await grpcError(() =>
      platformClients().rename({ resourceId: id, slug: "system-share-client" }),
    );
    expect(reserved.code).toBe(Code.InvalidArgument);
    const renamed = await platformClients().rename({
      resourceId: id,
      slug: "embed-renamed",
    });
    expect(renamed.metadata?.slug).toBe("embed-renamed");
    expect(renamed.spec?.clientSecretHash, "the response is redacted").toBe("");

    await server.store.updateResource(
      ApiResourceKind.platform_client,
      id,
      PlatformClientSchema,
      (row) => {
        if (row.metadata !== undefined) {
          row.metadata.labels[SYSTEM_MANAGED_LABEL] = "true";
        }
      },
    );
    const managed = await grpcError(() =>
      platformClients().rename({ resourceId: id, slug: "embed-again" }),
    );
    expect(managed.code).toBe(Code.FailedPrecondition);
    expect(managed.rawMessage).toBe(
      "This platform client is system-managed and cannot be renamed",
    );
  });

  it("an archived version read back names its agent by its current slug", async () => {
    const created = await agents().create(
      agentInput(ORG, "versioned-old", "first version"),
    );
    const id = created.metadata!.id;
    const firstHash = created.status!.versionHash;
    await agents().update({ resource: {
      ...agentInput(ORG, "versioned-old", "second version"),
      metadata: { id, org: ORG, name: "v", slug: "versioned-old" },
    }, updateMask: { paths: ["*"] } });
    await agents().rename({ resourceId: id, slug: "versioned-new" });

    const pinned = await agentQuery().getByReference({
      org: ORG,
      slug: "versioned-old",
      version: firstHash,
    });
    expect(pinned.spec?.instructions, "the archived version").toBe(
      "first version",
    );
    expect(pinned.metadata?.slug, "named by the resource's current slug").toBe(
      "versioned-new",
    );
    const byId = await agentQuery().getByReference({ id, version: firstHash });
    expect(byId.metadata?.slug).toBe("versioned-new");
  });

  describe("a rename between a writer's load and its write", () => {
    /**
     * Renames `id` to `to` when a write of that row first reaches the
     * store, after the writer's chain has loaded it; the rename's own
     * write passes through. A writer that rebuilds the row loses its swap
     * to the rename and runs again from a fresh read.
     */
    async function renameMidWrite<T>(
      kind: ApiResourceKind,
      id: string,
      rename: () => Promise<unknown>,
      write: () => Promise<T>,
    ): Promise<T> {
      const store = server.store;
      const updateResource = store.updateResource.bind(store);
      const saveResource = store.saveResource.bind(store);
      const swapResource = store.swapResource.bind(store);
      let armed = true;
      const fire = async (writtenKind: ApiResourceKind, writtenId: string) => {
        if (armed && writtenKind === kind && writtenId === id) {
          armed = false;
          await rename();
        }
      };
      const update = vi
        .spyOn(store, "updateResource")
        .mockImplementation((async <Desc extends DescMessage>(
          writtenKind: ApiResourceKind,
          writtenId: string,
          schema: Desc,
          modify: (msg: MessageShape<Desc>) => void,
        ) => {
          await fire(writtenKind, writtenId);
          return updateResource(writtenKind, writtenId, schema, modify);
        }) as typeof store.updateResource);
      const save = vi.spyOn(store, "saveResource").mockImplementation((async <
        Desc extends DescMessage,
      >(
        writtenKind: ApiResourceKind,
        writtenId: string,
        schema: Desc,
        msg: MessageShape<Desc>,
      ) => {
        await fire(writtenKind, writtenId);
        return saveResource(writtenKind, writtenId, schema, msg);
      }) as typeof store.saveResource);
      const swap = vi.spyOn(store, "swapResource").mockImplementation((async <
        Desc extends DescMessage,
      >(
        writtenKind: ApiResourceKind,
        writtenId: string,
        schema: Desc,
        expectedBytes: Uint8Array,
        msg: MessageShape<Desc>,
      ) => {
        await fire(writtenKind, writtenId);
        return swapResource(writtenKind, writtenId, schema, expectedBytes, msg);
      }) as typeof store.swapResource);
      try {
        const result = await write();
        expect(armed, "the rename landed mid-write").toBe(false);
        return result;
      } finally {
        update.mockRestore();
        save.mockRestore();
        swap.mockRestore();
      }
    }

    async function expectSlugKept<Desc extends DescMessage>(
      kind: ApiResourceKind,
      schema: Desc,
      id: string,
      slug: string,
    ): Promise<MessageShape<Desc>> {
      const row = await server.store.getResource(kind, id, schema);
      const metadata = (row as { metadata?: { slug: string; org: string } })
        .metadata;
      expect(metadata?.slug, "the row keeps the rename").toBe(slug);
      expect(
        await currentName(kind, metadata?.org ?? "", id),
        "the table agrees",
      ).toBe(slug);
      return row;
    }

    it("an agent update", async () => {
      const created = await agents().create(agentInput(ORG, "race-agent"));
      const id = created.metadata!.id;
      await renameMidWrite(
        ApiResourceKind.agent,
        id,
        () => agents().rename({ resourceId: id, slug: "race-agent-renamed" }),
        () =>
          agents().update({ resource: {
            ...agentInput(ORG, "race-agent", "edited mid-rename"),
            metadata: { id, org: ORG, name: "r", slug: "race-agent" },
          }, updateMask: { paths: ["*"] } }),
      );
      const row = await expectSlugKept(
        ApiResourceKind.agent,
        AgentSchema,
        id,
        "race-agent-renamed",
      );
      expect(row.spec?.instructions).toBe("edited mid-rename");
    });

    it("an agent visibility change", async () => {
      const created = await agents().create(agentInput(ORG, "race-visibility"));
      const id = created.metadata!.id;
      await renameMidWrite(
        ApiResourceKind.agent,
        id,
        () =>
          agents().rename({ resourceId: id, slug: "race-visibility-renamed" }),
        () =>
          agents().updateVisibility({
            resourceId: id,
            visibility: ApiResourceVisibility.visibility_org,
          }),
      );
      const row = await expectSlugKept(
        ApiResourceKind.agent,
        AgentSchema,
        id,
        "race-visibility-renamed",
      );
      expect(row.metadata?.visibility).toBe(
        ApiResourceVisibility.visibility_org,
      );
    });

    it("a channel app update", async () => {
      const created = await channelApps().create({
        apiVersion: AGENTIC,
        kind: "ChannelApp",
        metadata: { name: "race-channel-app", org: ORG },
        spec: {
          providerConfig: {
            case: "slack",
            value: { clientId: "a", clientSecret: "b", signingSecret: "c" },
          },
        },
      });
      const id = created.metadata!.id;
      await renameMidWrite(
        ApiResourceKind.channel_app,
        id,
        () =>
          channelApps().rename({
            resourceId: id,
            slug: "race-channel-app-renamed",
          }),
        () =>
          channelApps().update({ resource: {
            apiVersion: AGENTIC,
            kind: "ChannelApp",
            metadata: {
              id,
              name: "edited mid-rename",
              org: ORG,
              slug: "race-channel-app",
            },
            spec: {
              providerConfig: {
                case: "slack",
                value: {
                  clientId: "a2",
                  clientSecret: "***REDACTED***",
                  signingSecret: "***REDACTED***",
                },
              },
            },
          }, updateMask: { paths: ["*"] } }),
      );
      const row = await expectSlugKept(
        ApiResourceKind.channel_app,
        ChannelAppSchema,
        id,
        "race-channel-app-renamed",
      );
      expect(row.metadata?.name).toBe("edited mid-rename");
    });

    it("an OAuth app update", async () => {
      const spec = {
        provider: "RaceVendor",
        clientId: "race-client",
        clientSecret: "race-secret",
        authorizationUrl: "https://vendor.example.com/oauth/authorize",
        tokenUrl: "https://vendor.example.com/oauth/token",
        scopes: ["read"],
        addresses: ["https://race.vendor.example.com/mcp"],
      };
      const created = await oauthApps().create({
        apiVersion: IAM,
        kind: "OAuthApp",
        metadata: { name: "race-oauth-app", org: ORG },
        spec,
      });
      const id = created.metadata!.id;
      await renameMidWrite(
        ApiResourceKind.oauth_app,
        id,
        () =>
          oauthApps().rename({
            resourceId: id,
            slug: "race-oauth-app-renamed",
          }),
        () =>
          oauthApps().update({ resource: {
            apiVersion: IAM,
            kind: "OAuthApp",
            metadata: {
              id,
              name: "edited mid-rename",
              org: ORG,
              slug: "race-oauth-app",
            },
            spec: { ...spec, clientSecret: "***REDACTED***" },
          }, updateMask: { paths: ["*"] } }),
      );
      const row = await expectSlugKept(
        ApiResourceKind.oauth_app,
        OAuthAppSchema,
        id,
        "race-oauth-app-renamed",
      );
      expect(row.metadata?.name).toBe("edited mid-rename");
    });

    it("a schedule update", async () => {
      await agents().create(agentInput(ORG, "race-schedule-agent"));
      const input = (name: string, cron: string, id = "", slug = "") => ({
        apiVersion: AGENTIC,
        kind: "Schedule",
        metadata: { name, org: ORG, ...(id !== "" ? { id, slug } : {}) },
        spec: {
          cron,
          timeZone: "UTC",
          enabled: false,
          target: {
            case: "agent" as const,
            value: {
              agentRef: {
                kind: ApiResourceKind.agent,
                org: ORG,
                slug: "race-schedule-agent",
              },
              message: "go",
            },
          },
        },
      });
      const created = await schedules().create(
        input("race-schedule", "0 9 * * *"),
      );
      const id = created.metadata!.id;
      await renameMidWrite(
        ApiResourceKind.schedule,
        id,
        () =>
          schedules().rename({ resourceId: id, slug: "race-schedule-renamed" }),
        () =>
          schedules().update(
            { resource: input("race-schedule", "0 10 * * *", id, "race-schedule"), updateMask: { paths: ["*"] } },
          ),
      );
      const row = await expectSlugKept(
        ApiResourceKind.schedule,
        ScheduleSchema,
        id,
        "race-schedule-renamed",
      );
      expect(row.spec?.cron).toBe("0 10 * * *");
    });

    it("a vault update", async () => {
      const created = await vaults().create({
        apiVersion: AGENTIC,
        kind: "Vault",
        metadata: { name: "race-vault", org: ORG },
        spec: { description: "before" },
      });
      const id = created.metadata!.id;
      await renameMidWrite(
        ApiResourceKind.vault,
        id,
        () => vaults().rename({ resourceId: id, slug: "race-vault-renamed" }),
        () =>
          vaults().update({ resource: {
            apiVersion: AGENTIC,
            kind: "Vault",
            metadata: { id, name: "race-vault", org: ORG, slug: "race-vault" },
            spec: { description: "edited mid-rename" },
          }, updateMask: { paths: ["*"] } }),
      );
      const row = await expectSlugKept(
        ApiResourceKind.vault,
        VaultSchema,
        id,
        "race-vault-renamed",
      );
      expect(row.spec?.description).toBe("edited mid-rename");
    });

    it("a platform client update and a secret rotation", async () => {
      const created = await platformClients().create({
        apiVersion: IAM,
        kind: "PlatformClient",
        metadata: { name: "race-client", org: ORG },
        spec: {},
      });
      const id = created.platformClient!.metadata!.id;
      await renameMidWrite(
        ApiResourceKind.platform_client,
        id,
        () =>
          platformClients().rename({
            resourceId: id,
            slug: "race-client-renamed",
          }),
        () =>
          platformClients().update({ resource: {
            apiVersion: IAM,
            kind: "PlatformClient",
            metadata: {
              id,
              name: "edited mid-rename",
              org: ORG,
              slug: "race-client",
            },
            spec: {},
          }, updateMask: { paths: ["*"] } }),
      );
      let row = await expectSlugKept(
        ApiResourceKind.platform_client,
        PlatformClientSchema,
        id,
        "race-client-renamed",
      );
      expect(row.metadata?.name).toBe("edited mid-rename");

      const before = row.spec?.clientSecretHash;
      await renameMidWrite(
        ApiResourceKind.platform_client,
        id,
        () =>
          platformClients().rename({
            resourceId: id,
            slug: "race-client-rotated",
          }),
        () => platformClients().rotateSecret({ value: id }),
      );
      row = await expectSlugKept(
        ApiResourceKind.platform_client,
        PlatformClientSchema,
        id,
        "race-client-rotated",
      );
      expect(row.spec?.clientSecretHash, "the rotation landed").not.toBe(
        before,
      );
      expect(row.metadata?.name, "the rotation wrote its secret alone").toBe(
        "edited mid-rename",
      );
    });
  });

  describe("a row deleted between a writer's load and its write", () => {
    /** Deletes the row when a write of it first reaches the store, after the writer's chain loaded it. */
    async function deleteMidWrite<T>(
      kind: ApiResourceKind,
      id: string,
      write: () => Promise<T>,
    ): Promise<ConnectError> {
      const store = server.store;
      const updateResource = store.updateResource.bind(store);
      const swapResource = store.swapResource.bind(store);
      let armed = true;
      const vanish = async (writtenKind: ApiResourceKind, writtenId: string) => {
        if (armed && writtenKind === kind && writtenId === id) {
          armed = false;
          await store.deleteResource(kind, id);
        }
      };
      const spy = vi.spyOn(store, "updateResource").mockImplementation((async <
        Desc extends DescMessage,
      >(
        writtenKind: ApiResourceKind,
        writtenId: string,
        schema: Desc,
        modify: (msg: MessageShape<Desc>) => void,
      ) => {
        await vanish(writtenKind, writtenId);
        return updateResource(writtenKind, writtenId, schema, modify);
      }) as typeof store.updateResource);
      const swap = vi.spyOn(store, "swapResource").mockImplementation((async <
        Desc extends DescMessage,
      >(
        writtenKind: ApiResourceKind,
        writtenId: string,
        schema: Desc,
        expectedBytes: Uint8Array,
        msg: MessageShape<Desc>,
      ) => {
        await vanish(writtenKind, writtenId);
        return swapResource(writtenKind, writtenId, schema, expectedBytes, msg);
      }) as typeof store.swapResource);
      try {
        return await grpcError(write);
      } finally {
        spy.mockRestore();
        swap.mockRestore();
      }
    }

    it("an agent's visibility change answers NotFound", async () => {
      const created = await agents().create(
        agentInput(ORG, "vanish-visibility"),
      );
      const id = created.metadata!.id;
      const missing = await deleteMidWrite(ApiResourceKind.agent, id, () =>
        agents().updateVisibility({
          resourceId: id,
          visibility: ApiResourceVisibility.visibility_org,
        }),
      );
      expect(missing.code).toBe(Code.NotFound);
      expect(missing.rawMessage).toBe(`agent not found: ${id}`);
    });

    it("a platform client's update and rotation answer NotFound", async () => {
      const writes: ReadonlyArray<
        readonly [string, (id: string) => Promise<unknown>]
      > = [
        [
          "vanishing-update",
          (id) =>
            platformClients().update({ resource: {
              apiVersion: IAM,
              kind: "PlatformClient",
              metadata: { id, name: "gone", org: ORG },
              spec: {},
            }, updateMask: { paths: ["*"] } }),
        ],
        [
          "vanishing-rotate",
          (id) => platformClients().rotateSecret({ value: id }),
        ],
      ];
      for (const [name, write] of writes) {
        const created = await platformClients().create({
          apiVersion: IAM,
          kind: "PlatformClient",
          metadata: { name, org: ORG },
          spec: {},
        });
        const id = created.platformClient!.metadata!.id;
        const missing = await deleteMidWrite(
          ApiResourceKind.platform_client,
          id,
          () => write(id),
        );
        expect(missing.code).toBe(Code.NotFound);
        expect(missing.rawMessage).toBe(`PlatformClient not found: ${id}`);
      }
    });

    it("an organization's rename answers NotFound and leaves the old slug its own", async () => {
      const organizations = createClient(OrganizationCommandController, wire);
      const created = await organizations.create({
        apiVersion: "tenancy.stigmer.ai/v1",
        kind: "Organization",
        metadata: { name: "vanishing-org", slug: "vanishing-org" },
      });
      const id = created.metadata!.id;
      const missing = await deleteMidWrite(
        ApiResourceKind.organization,
        id,
        () => organizations.rename({ resourceId: id, slug: "vanished-org" }),
      );
      expect(missing.code).toBe(Code.NotFound);
      expect(missing.rawMessage).toBe(`Organization not found: ${id}`);
    });
  });

  it("a platform client's create of a renamed-away slug is refused with SLUG_RESERVED", async () => {
    const created = await platformClients().create({
      apiVersion: IAM,
      kind: "PlatformClient",
      metadata: { name: "held-client", org: ORG },
      spec: {},
    });
    await platformClients().rename({
      resourceId: created.platformClient!.metadata!.id,
      slug: "held-client-renamed",
    });
    const reserved = await grpcError(() =>
      platformClients().create({
        apiVersion: IAM,
        kind: "PlatformClient",
        metadata: { name: "held-client", org: ORG },
        spec: {},
      }),
    );
    expect(reserved.code).toBe(Code.AlreadyExists);
    expect(reasonOf(reserved)?.reason).toBe(SLUG_RESERVED);
  });
});
