// Conformance suite for the update contract every kind keeps (Class A).
//
// An update names its target by resource.metadata.id and the fields it
// changes by update_mask (AIP-134); every field it does not name keeps its
// stored value. A read carries metadata.etag, and an update that sends an
// etag the resource has moved past is refused with ABORTED and ErrorInfo
// reason ETAG_MISMATCH (AIP-154). The server's inventory of what each
// kind's update refuses is backend/services/stigmer-server/docs/update-paths.md.
//
// Asserted, per kind:
// - an update naming metadata.name changes the name and leaves the spec as
//   stored;
// - an update carrying an etag read before another write is refused with
//   ABORTED ETAG_MISMATCH, and writes nothing;
// - a mask naming a path the kind does not have is refused with
//   INVALID_ARGUMENT naming the path;
// - for a kind whose update refuses a field another door writes, naming it
//   is refused with INVALID_ARGUMENT naming the door.
import { create, toJsonString } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { ChannelSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/spec_pb";
import { ChannelAppSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/channelapp/v1/spec_pb";
import { RoutineSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/spec_pb";
import { SessionSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/spec_pb";
import { VaultSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/spec_pb";
import { ApiKeySpecSchema } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/spec_pb";
import { OAuthAppSpecSchema } from "@stigmer/apis/ai/stigmer/iam/oauthapp/v1/spec_pb";
import { OrganizationSpecSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/spec_pb";
import { ErrorInfoSchema } from "@stigmer/apis/google/rpc/error_details_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { agentRefOf, makeAgent } from "../support/agents";
import { makeSlackChannelApp } from "../support/channelapps";
import { makeWebChannel } from "../support/channels";
import { uniqueName } from "../support/naming";
import { makeOAuthApp } from "../support/oauthapps";
import { makeRoutine } from "../support/routines";
import { makeSession } from "../support/sessions";
import { makeSharedVault } from "../support/vaults";
import { createTarget, type TargetProfile } from "../targets";

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

/** What an arm reads of a resource: its address, name, etag and spec. */
interface Snapshot {
  readonly id: string;
  readonly name: string;
  readonly etag: string;
  readonly spec: string;
}

/** The metadata an arm's update sends. */
interface UpdateMetadata {
  readonly id: string;
  readonly name?: string;
  readonly etag?: string;
}

/** One kind's update, through the wire. */
interface UpdatableKind {
  /** The resource message's name, as the server's refusals spell it. */
  readonly noun: string;
  readonly rpc: string;
  /** A field the kind's update refuses, and who writes it instead. */
  readonly refused?: { readonly path: string; readonly writtenBy: string };
  /** Makes one in `org` and answers its id; deleted at the end of the arm. */
  create(org: string): Promise<string>;
  read(id: string): Promise<Snapshot>;
  update(metadata: UpdateMetadata, paths: string[]): Promise<Snapshot>;
}

interface Readable {
  readonly metadata?: { readonly id: string; readonly name: string; readonly etag: string };
}

function snapshotOf<S extends DescMessage>(
  specSchema: S,
  resource: Readable & { readonly spec?: Parameters<typeof toJsonString<S>>[1] },
): Snapshot {
  return {
    id: resource.metadata?.id ?? "",
    name: resource.metadata?.name ?? "",
    etag: resource.metadata?.etag ?? "",
    spec: toJsonString(specSchema, resource.spec ?? create(specSchema)),
  };
}

async function agentIn(org: string): Promise<{ id: string; slug: string }> {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("upd-agent") }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return { id: agent.metadata!.id, slug: agent.metadata!.slug };
}

const KINDS: ReadonlyArray<UpdatableKind> = [
  {
    noun: "Agent",
    rpc: "AgentCommandController.update",
    create: async (org) => (await agentIn(org)).id,
    read: async (id) => snapshotOf(AgentSpecSchema, await clients.agentQuery.get({ value: id })),
    update: async (metadata, paths) =>
      snapshotOf(AgentSpecSchema, await clients.agentCommand.update({ resource: { metadata }, updateMask: { paths } })),
  },
  {
    noun: "Vault",
    rpc: "VaultCommandController.update",
    refused: { path: "spec.secrets", writtenBy: "setSecrets and removeSecrets" },
    create: async (org) => {
      const vault = await clients.vaultCommand.create(makeSharedVault({ org, name: uniqueName("upd-vault") }));
      fixtures.defer(() => clients.vaultCommand.delete({ resourceId: vault.metadata!.id }));
      return vault.metadata!.id;
    },
    read: async (id) => snapshotOf(VaultSpecSchema, await clients.vaultQuery.get({ value: id })),
    update: async (metadata, paths) =>
      snapshotOf(VaultSpecSchema, await clients.vaultCommand.update({ resource: { metadata }, updateMask: { paths } })),
  },
  {
    noun: "OAuthApp",
    rpc: "OAuthAppCommandController.update",
    create: async (org) => {
      const app = await clients.oauthAppCommand.create(makeOAuthApp(org, uniqueName("upd-oauth")));
      fixtures.defer(() => clients.oauthAppCommand.delete({ resourceId: app.metadata!.id }));
      return app.metadata!.id;
    },
    read: async (id) => snapshotOf(OAuthAppSpecSchema, await clients.oauthAppQuery.get({ value: id })),
    update: async (metadata, paths) =>
      snapshotOf(OAuthAppSpecSchema, await clients.oauthAppCommand.update({ resource: { metadata }, updateMask: { paths } })),
  },
  {
    noun: "ApiKey",
    rpc: "ApiKeyCommandController.update",
    refused: { path: "spec.key_hash", writtenBy: "the server, when the key is minted" },
    create: async (org) => {
      const key = await clients.apiKeyCommand.create({
        apiVersion: "iam.stigmer.ai/v1",
        kind: "ApiKey",
        metadata: { name: uniqueName("upd-key"), org },
        spec: {},
      });
      fixtures.defer(() => clients.apiKeyCommand.delete({ value: key.metadata!.id }));
      return key.metadata!.id;
    },
    read: async (id) => snapshotOf(ApiKeySpecSchema, await clients.apiKeyQuery.get({ value: id })),
    update: async (metadata, paths) =>
      snapshotOf(ApiKeySpecSchema, await clients.apiKeyCommand.update({ resource: { metadata }, updateMask: { paths } })),
  },
  {
    noun: "Organization",
    rpc: "OrganizationCommandController.update",
    refused: { path: "spec.policies", writtenBy: "updatePolicies" },
    // The arm's own organization, which its tenancy deletes.
    create: async (org) => org,
    read: async (id) => snapshotOf(OrganizationSpecSchema, await clients.organizationQuery.get({ value: id })),
    update: async (metadata, paths) =>
      snapshotOf(
        OrganizationSpecSchema,
        await clients.organizationCommand.update({ resource: { metadata }, updateMask: { paths } }),
      ),
  },
  {
    noun: "Session",
    rpc: "SessionCommandController.update",
    create: async (org) => {
      const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("upd-sess-agent") }));
      fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
      const session = await clients.sessionCommand.create(
        makeSession({ org, name: uniqueName("upd-session"), agentRef: agentRefOf(agent) }),
      );
      fixtures.defer(() => clients.sessionCommand.delete({ value: session.metadata!.id }));
      return session.metadata!.id;
    },
    read: async (id) => snapshotOf(SessionSpecSchema, await clients.sessionQuery.get({ value: id })),
    update: async (metadata, paths) =>
      snapshotOf(SessionSpecSchema, await clients.sessionCommand.update({ resource: { metadata }, updateMask: { paths } })),
  },
  {
    noun: "Routine",
    rpc: "RoutineCommandController.update",
    create: async (org) => {
      const agent = await agentIn(org);
      const routine = await clients.routineCommand.create(makeRoutine(org, uniqueName("upd-sched"), agent.slug));
      fixtures.defer(() => clients.routineCommand.delete({ value: routine.metadata!.id }));
      return routine.metadata!.id;
    },
    read: async (id) => snapshotOf(RoutineSpecSchema, await clients.routineQuery.get({ value: id })),
    update: async (metadata, paths) =>
      snapshotOf(RoutineSpecSchema, await clients.routineCommand.update({ resource: { metadata }, updateMask: { paths } })),
  },
  {
    noun: "Channel",
    rpc: "ChannelCommandController.update",
    create: async (org) => {
      const agent = await agentIn(org);
      const channel = await clients.channelCommand.create(makeWebChannel(org, agent.slug, { name: uniqueName("upd-web") }));
      fixtures.defer(() => clients.channelCommand.delete({ value: channel.metadata!.id }));
      return channel.metadata!.id;
    },
    read: async (id) => snapshotOf(ChannelSpecSchema, await clients.channelQuery.get({ value: id })),
    update: async (metadata, paths) =>
      snapshotOf(ChannelSpecSchema, await clients.channelCommand.update({ resource: { metadata }, updateMask: { paths } })),
  },
  {
    noun: "ChannelApp",
    rpc: "ChannelAppCommandController.update",
    create: async (org) => {
      const app = await clients.channelAppCommand.create(makeSlackChannelApp(org, uniqueName("upd-app")));
      fixtures.defer(() => clients.channelAppCommand.delete({ resourceId: app.metadata!.id }));
      return app.metadata!.id;
    },
    read: async (id) => snapshotOf(ChannelAppSpecSchema, await clients.channelAppQuery.get({ value: id })),
    update: async (metadata, paths) =>
      snapshotOf(ChannelAppSpecSchema, await clients.channelAppCommand.update({ resource: { metadata }, updateMask: { paths } })),
  },
];

for (const kind of KINDS) {
  describe(`[rpc:${kind.rpc}] the update contract — ${kind.noun}`, () => {
    it("changes only what its mask names: the name moves, the spec stays as stored", async () => {
      const { org } = await target.provisionTenancy();
      const id = await kind.create(org);
      const before = await kind.read(id);

      const name = uniqueName("renamed");
      const updated = await kind.update({ id, name }, ["metadata.name"]);
      expect(updated.name).toBe(name);
      expect(updated.spec, "a field the mask does not name keeps its stored value").toBe(before.spec);
      expect((await kind.read(id)).spec).toBe(before.spec);
    });

    it("refuses an etag read before another write with ABORTED ETAG_MISMATCH, writing nothing", async () => {
      const { org } = await target.provisionTenancy();
      const id = await kind.create(org);
      const read = await kind.read(id);
      expect(read.etag, "a read carries its etag").not.toBe("");

      const moved = await kind.update({ id, name: uniqueName("teammate"), etag: read.etag }, ["metadata.name"]);
      expect(moved.etag, "a change moves the etag").not.toBe(read.etag);

      const refused = await expectGrpcCode(
        () => kind.update({ id, name: uniqueName("stale"), etag: read.etag }, ["metadata.name"]),
        Code.Aborted,
        "an update carrying a stale etag",
      );
      expect(refused.findDetails(ErrorInfoSchema)[0]?.reason).toBe("ETAG_MISMATCH");
      expect((await kind.read(id)).name, "nothing was written").toBe(moved.name);
    });

    it("refuses a mask naming a path the kind does not have, naming it", async () => {
      const { org } = await target.provisionTenancy();
      const id = await kind.create(org);
      const refused = await expectGrpcCode(
        () => kind.update({ id }, ["spec.no_such_field"]),
        Code.InvalidArgument,
        "an update naming an unknown path",
      );
      expect(refused.rawMessage).toContain(`update_mask path 'spec.no_such_field' is not a field of ${kind.noun}`);
    });

    const refused = kind.refused;
    if (refused !== undefined) {
      it(`refuses a mask naming ${refused.path}, which ${refused.writtenBy} writes`, async () => {
        const { org } = await target.provisionTenancy();
        const id = await kind.create(org);
        const error = await expectGrpcCode(
          () => kind.update({ id }, [refused.path]),
          Code.InvalidArgument,
          "an update naming a field another door writes",
        );
        expect(error.rawMessage).toContain(
          `update_mask path '${refused.path}' is written by ${refused.writtenBy}, not by update`,
        );
      });
    }
  });
}
