// PlatformClient conformance: the CRUD contract every edition serves, on the
// target's primary.
//
// Pins:
//   - create answers the client and its secret ONCE: `pcl_` id, a
//     `stgm_cid_` client_id, a `stgm_cs_` secret whose last six characters
//     are the fingerprint; no read ever returns the secret or its hash
//     (create, get, getByReference, listByOrg, update, rotateSecret, delete);
//   - update replaces the spec but never the credentials (client_id,
//     fingerprint kept from the stored client);
//   - rotateSecret answers a new secret and fingerprint under the same
//     client_id;
//   - `system-share-client` is refused on create, the auto-grant rules are
//     refused on the contract, and a deleted client is gone;
//   - on a server that trusts every request, mintUserToken is refused
//     FAILED_PRECONDITION — nothing there would verify the token.
//
// Out of scope: who may read a client, the mint's identity and
// organization contract, and the minting client's enforcement — the
// enforcing lane's (platformclient-enforcement.conformance.test.ts).
import { clone, create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { PlatformClient } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { PlatformClientSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { PlatformClientSpecSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/spec_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "../support/naming";
import {
  createPlatformClient,
  deletePlatformClient,
  type ProvisionedPlatformClient,
} from "../support/platformclients";
import { createTarget, type TargetProfile } from "../targets";

const RESERVED_SLUG_MESSAGE =
  "The slug 'system-share-client' is reserved for the platform's system-managed" +
  " resources and cannot be used. If you did not provide a slug" +
  " explicitly, it was derived from the resource name — choose a" +
  " different name or provide an explicit slug.";

const trustsEveryRequest = !createTarget().capabilities.requiresAuthentication;

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

async function organization(): Promise<string> {
  const context = await target.provisionTenancy();
  fixtures.defer(() => target.cleanupTenancy(context));
  return context.org;
}

async function platformClient(org: string): Promise<ProvisionedPlatformClient> {
  const client = await createPlatformClient(clients, {
    org,
    name: uniqueName("crud-pc"),
  });
  fixtures.defer(async () => {
    try {
      await deletePlatformClient(clients, client.id);
    } catch {
      // The delete arm removed it already.
    }
  });
  return client;
}

function expectRedacted(
  client: PlatformClient | undefined,
  where: string,
): void {
  expect(client, `${where} must answer the client`).toBeDefined();
  expect(
    client?.spec?.clientSecretHash,
    `${where} must never return the secret hash`,
  ).toBe("");
}

describe("PlatformClient conformance — CRUD on the primary", () => {
  it("create answers the client and its secret once, and no read returns the secret or its hash", async () => {
    const org = await organization();
    const client = await platformClient(org);
    const created = client.created.platformClient;

    expect(client.id).toMatch(/^pcl_/);
    expect(client.credentials.clientId).toMatch(/^stgm_cid_[A-Za-z0-9_-]{43}$/);
    expect(client.credentials.clientSecret).toMatch(
      /^stgm_cs_[A-Za-z0-9_-]{64}$/,
    );
    expect(created?.spec?.secretFingerprint).toBe(
      client.credentials.clientSecret.slice(-6),
    );
    expectRedacted(created, "create");

    expectRedacted(
      await clients.platformClientQuery.get({ value: client.id }),
      "get",
    );
    expectRedacted(
      await clients.platformClientQuery.getByReference({
        org,
        slug: client.slug,
        kind: ApiResourceKind.platform_client,
      }),
      "getByReference",
    );
    const listed = await clients.platformClientQuery.listByOrg({ org });
    const entry = listed.entries.find(
      (candidate) => candidate.metadata?.id === client.id,
    );
    expectRedacted(entry, "listByOrg");
  });

  it("update replaces the spec but keeps the credentials", async () => {
    const org = await organization();
    const client = await platformClient(org);
    const stored = client.created.platformClient;
    if (stored?.spec === undefined) {
      throw new Error("create answered no client spec");
    }
    const edited = clone(PlatformClientSchema, stored);
    const spec = create(PlatformClientSpecSchema, {
      ...stored.spec,
      clientId: "stgm_cid_forged",
      secretFingerprint: "forged",
      allowedOrigins: ["https://app.example"],
    });
    edited.spec = spec;

    const updated = await clients.platformClientCommand.update(edited);

    expect(updated.spec?.allowedOrigins).toEqual(["https://app.example"]);
    expect(updated.spec?.clientId).toBe(client.credentials.clientId);
    expect(updated.spec?.secretFingerprint).toBe(
      client.credentials.clientSecret.slice(-6),
    );
    expectRedacted(updated, "update");
  });

  it("rotateSecret answers a new secret and fingerprint under the same client_id", async () => {
    const org = await organization();
    const client = await platformClient(org);

    const rotated = await clients.platformClientCommand.rotateSecret({
      value: client.id,
    });

    expect(rotated.clientSecret).toMatch(/^stgm_cs_[A-Za-z0-9_-]{64}$/);
    expect(rotated.clientSecret).not.toBe(client.credentials.clientSecret);
    expect(rotated.platformClient?.spec?.clientId).toBe(
      client.credentials.clientId,
    );
    expect(rotated.platformClient?.spec?.secretFingerprint).toBe(
      rotated.clientSecret.slice(-6),
    );
    expectRedacted(rotated.platformClient, "rotateSecret");
  });

  it("the reserved slug and the auto-grant rules are refused on create", async () => {
    const org = await organization();

    const reserved = await expectGrpcCode(
      () =>
        clients.platformClientCommand.create({
          apiVersion: "iam.stigmer.ai/v1",
          kind: "PlatformClient",
          metadata: {
            name: "System Share Client",
            org,
            slug: "system-share-client",
          },
          spec: {},
        }),
      Code.InvalidArgument,
      "create under the platform's reserved slug",
    );
    expect(reserved.rawMessage).toBe(RESERVED_SLUG_MESSAGE);

    await expectGrpcCode(
      () =>
        clients.platformClientCommand.create({
          apiVersion: "iam.stigmer.ai/v1",
          kind: "PlatformClient",
          metadata: { name: uniqueName("owner-grant"), org },
          spec: {
            autoProvisionAccounts: true,
            autoGrantOnOrg: true,
            autoGrantRole: IamRole.owner,
          },
        }),
      Code.InvalidArgument,
      "a client that would auto-grant ownership",
    );

    await expectGrpcCode(
      () =>
        clients.platformClientCommand.create({
          apiVersion: "iam.stigmer.ai/v1",
          kind: "PlatformClient",
          metadata: { name: uniqueName("grant-no-provision"), org },
          spec: { autoProvisionAccounts: false, autoGrantOnOrg: true },
        }),
      Code.InvalidArgument,
      "a client that would auto-grant without provisioning",
    );
  });

  it("delete answers the deleted client without its hash, and the client is gone", async () => {
    const org = await organization();
    const client = await platformClient(org);

    const deleted = await clients.platformClientCommand.delete({
      resourceId: client.id,
    });
    expect(deleted.metadata?.id).toBe(client.id);
    expectRedacted(deleted, "delete");

    const listed = await clients.platformClientQuery.listByOrg({ org });
    expect(listed.entries.map((entry) => entry.metadata?.id)).not.toContain(
      client.id,
    );
  });
});

describe.skipIf(!trustsEveryRequest)(
  "PlatformClient conformance — a server that trusts every request (targets without authentication)",
  () => {
    it("mintUserToken is refused FAILED_PRECONDITION: nothing would verify the token", async () => {
      const org = await organization();
      const client = await platformClient(org);

      await expectGrpcCode(
        () =>
          clients.platformClientToken.mintUserToken({
            clientId: client.credentials.clientId,
            clientSecret: client.credentials.clientSecret,
            userId: uniqueName("trusted-local-user"),
          }),
        Code.FailedPrecondition,
        "a mint on a server with no authentication posture",
      );
    });
  },
);
