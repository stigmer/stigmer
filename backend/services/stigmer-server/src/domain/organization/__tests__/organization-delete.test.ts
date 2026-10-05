/**
 * Pins the organization delete through a composed server in the
 * trusted-local posture: the delete marks the organization and revokes
 * everything that grants on it, and answers; the purge then removes its row
 * and, last, its names. Every row names the organization by its minted id,
 * which no later organization carries, so nothing a deleted organization
 * left behind passes to a later holder of its slug.
 *
 *   - the `org-delete:pre-delete` slot runs with the organization loaded
 *     and still stored, and its rows still in place;
 *   - from the answer on, the organization answers not-found, a second
 *     delete included, while its row and its name are still held: the slug
 *     cannot be taken until the purge finishes, and then it can;
 *   - a slot step's refusal answers its own code and copy, and leaves the
 *     organization, its rows and its name, unmarked;
 *   - the organization's policy rows are revoked before the answer, as
 *     principal and as resource: a revocation fault answers Internal with
 *     fixed copy, leaves the organization and its owner row, unmarked, and
 *     a retry completes the delete;
 *   - a fault releasing the names in the purge is logged and the purge
 *     finishes; the name then leads to no organization;
 *   - a create of a deleted organization's slug once the purge finished
 *     makes a new organization, which no row of the old one names.
 *
 * The policy store is the library's in-memory double, composed as the
 * IamPolicy store driver so a test can make one row's delete fault; the
 * grant path, the role lifecycle, the chain and the purge are the
 * library's own. The test unit's purge stage holds an organization the
 * test names until it lets go, so the arms can look between the delete's
 * answer and the purge's end.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { DescMessage } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { IamPolicyCommandController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/command_pb";
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import type { GateSlotName } from "../../../extensions/gate-slots.js";
import type { OrganizationPurgeStage } from "../../../extensions/organization-purge.js";
import type { ServerExtension } from "../../../extensions/registry.js";
import type { PipelineStep } from "../../../pipeline/pipeline.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { organizationNameKey } from "../names.js";
import {
  resetOperatorIdentityForTests,
  setOperatorIdentity,
} from "../../../pipeline/steps/defaults.js";
import {
  fakeIamPolicyStore,
  orgRole,
  triple,
} from "../../iampolicy/__tests__/support.js";

const OPERATOR_EMAIL = "operator@example.com";
const REFUSED_SLUG = "delete-refused";
const OUTSIDER = "ida_0byc5k14t1e7b7kdxft7hwz1f7";
const AGENT = "agt_01hzzzzzzzzzzzzzzzzzzzzzzz";

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

describe("organization delete (composed server, trusted-local posture)", () => {
  const policies = fakeIamPolicyStore();
  /** A policy id whose delete faults while set: the store answering an error mid-revocation. */
  let faultingDelete: string | undefined;
  const faultablePolicies = {
    ...policies,
    async deleteById(id: string): Promise<void> {
      if (id === faultingDelete) {
        throw new Error("policy store unavailable");
      }
      await policies.deleteById(id);
    },
  };

  /** What the slot's step saw, per organization, while it ran. */
  const seenBySlot = new Map<string, { loaded: string; rowsNaming: number }>();
  const slotStep: PipelineStep<DescMessage> = {
    name: "FakeOrgDeleteStep",
    execute: (ctx) => {
      const organization = ctx.get(EXISTING_RESOURCE_KEY) as
        | Organization
        | undefined;
      const id = organization?.metadata?.id ?? "";
      seenBySlot.set(id, { loaded: id, rowsNaming: rowsNaming(id).length });
      if (organization?.metadata?.slug === REFUSED_SLUG) {
        throw new ConnectError(
          "fake edition keeps something for this organization",
          Code.FailedPrecondition,
        );
      }
    },
  };
  /** Organizations the purge holds, between the delete's answer and the purge's end. */
  const held = new Set<string>();
  const holdStage: OrganizationPurgeStage = {
    name: "test-hold",
    async run(context) {
      return held.has(context.org.id) ? { more: true, wait: true } : { more: false };
    },
  };
  const unit: ServerExtension = {
    name: "fake-org-delete",
    gateSteps: new Map<GateSlotName, ReadonlyArray<PipelineStep<DescMessage>>>([
      ["org-delete:pre-delete", [slotStep]],
    ]),
    drivers: { iamPolicyStore: faultablePolicies },
    orgPurge: { stages: [holdStage] },
  };

  let dir: string;
  let server: ComposedServer;
  let transport: Transport;
  let organizations: Client<typeof OrganizationCommandController>;
  let organizationQuery: Client<typeof OrganizationQueryController>;
  /** The platform's own pipeline: the in-process transport's `internal` caller. */
  let platform: Client<typeof IamPolicyCommandController>;

  function rowsNaming(org: string): IamPolicy[] {
    return [...policies.rows.values()].filter(
      (policy) =>
        (policy.spec?.resource?.kind === "organization" &&
          policy.spec.resource.id === org) ||
        (policy.spec?.principal?.kind === "organization" &&
          policy.spec.principal.id === org),
    );
  }

  /**
   * An organization with its creator's owner row, an outsider's member row,
   * and an agent's scope link to it; answers its minted id, which the rows
   * name.
   */
  async function organizationWithRows(slug: string): Promise<string> {
    const created = await organizations.create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: slug, slug, org: "" },
      spec: { description: "created by the organization delete test" },
    });
    const id = created.metadata?.id ?? "";
    await platform.bootstrapPolicy(orgRole(OUTSIDER, "member", id));
    await platform.bootstrapPolicy(
      triple({ kind: "organization", id }, "organization", {
        kind: "agent",
        id: AGENT,
      }),
    );
    return id;
  }

  /** Lets the purge of `id` finish, and runs a pass until it has. */
  async function purged(id: string): Promise<void> {
    held.delete(id);
    await vi.waitFor(async () => {
      await server.organizationPurge.runPass();
      expect(await server.store.organizationDeletions.isDeleting(id)).toBe(false);
    });
  }

  const nameOf = (slug: string) =>
    server.store.resourceNames.resolve(
      organizationNameKey(slug),
      new Date().toISOString(),
    );

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), "organization-delete-test-"));
    setOperatorIdentity(OPERATOR_EMAIL, "The Operator");
    server = await composeServer({
      config: loadConfig({
        STIGMER_MODEL_REGISTRY_REFRESH: "off",
        TEMPORAL_HOST_PORT: "127.0.0.1:1",
        DB_PATH: path.join(dir, "stigmer.db"),
        STORAGE_PATH: path.join(dir, "storage"),
        ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
        STIGMER_OPERATOR_EMAIL: OPERATOR_EMAIL,
      }),
      logger: createLogger({ level: "error", pretty: false, write: () => {} }),
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    const port = await server.start();
    transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
    organizations = createClient(OrganizationCommandController, transport);
    organizationQuery = createClient(OrganizationQueryController, transport);
    platform = createClient(
      IamPolicyCommandController,
      server.inProcessTransport,
    );
  });

  afterAll(async () => {
    await server.shutdown();
    resetOperatorIdentityForTests();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    faultingDelete = undefined;
  });

  it("runs the slot with the organization and its rows in place, revokes every row naming it, and answers", async () => {
    const id = await organizationWithRows("delete-clean");
    expect(rowsNaming(id)).toHaveLength(3);
    held.add(id);

    await organizations.delete({ value: "delete-clean" });

    expect(seenBySlot.get(id)).toEqual({ loaded: id, rowsNaming: 3 });
    expect(rowsNaming(id)).toEqual([]);
    const gone = await grpcError(() =>
      organizationQuery.get({ value: "delete-clean" }),
    );
    expect(gone.code).toBe(Code.NotFound);
    expect(gone.rawMessage).toBe(`Organization not found: ${id}`);
    const again = await grpcError(() =>
      organizations.delete({ value: "delete-clean" }),
    );
    expect(again.code, "a second delete").toBe(Code.NotFound);

    await purged(id);
    expect(await nameOf("delete-clean")).toBeUndefined();
  });

  it("holds the slug while the purge runs and frees it when the purge finishes", async () => {
    const id = await organizationWithRows("delete-held");
    held.add(id);
    await organizations.delete({ value: "delete-held" });

    expect((await nameOf("delete-held"))?.id).toBe(id);
    const taken = await grpcError(() =>
      organizations.create({
        apiVersion: "tenancy.stigmer.ai/v1",
        kind: "Organization",
        metadata: { name: "delete-held", slug: "delete-held", org: "" },
      }),
    );
    expect(taken.code).toBe(Code.AlreadyExists);

    await purged(id);
    expect(await nameOf("delete-held")).toBeUndefined();
    const reborn = await organizations.create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: "delete-held", slug: "delete-held", org: "" },
    });
    expect(reborn.metadata?.id).not.toBe(id);
  });

  it("a slot step's refusal answers its own copy and leaves the organization, its rows and its name", async () => {
    const id = await organizationWithRows(REFUSED_SLUG);

    const refused = await grpcError(() =>
      organizations.delete({ value: REFUSED_SLUG }),
    );

    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe(
      "fake edition keeps something for this organization",
    );
    expect(
      (await organizationQuery.get({ value: REFUSED_SLUG })).metadata?.id,
    ).toBe(id);
    expect(rowsNaming(id)).toHaveLength(3);
    expect((await nameOf(REFUSED_SLUG))?.id).toBe(id);
    expect(await server.store.organizationDeletions.isDeleting(id)).toBe(false);
  });

  it("a fault releasing the names in the purge is logged, and the purge finishes", async () => {
    const id = await organizationWithRows("delete-release-faults");
    held.add(id);
    await organizations.delete({ value: "delete-release-faults" });
    const release = vi
      .spyOn(server.store.resourceNames, "release")
      .mockRejectedValueOnce(new Error("name table unavailable"));
    try {
      await purged(id);
    } finally {
      release.mockRestore();
    }
    expect(rowsNaming(id)).toEqual([]);
    // The name still points at the deleted id, which leads nowhere; a claim
    // frees it once it is old enough to be no create in flight (names.ts).
    expect((await nameOf("delete-release-faults"))?.id).toBe(id);
    const gone = await grpcError(() =>
      organizationQuery.get({ value: "delete-release-faults" }),
    );
    expect(gone.code).toBe(Code.NotFound);
  });

  it("a revocation fault fails the delete with the organization and its owner in place, and the retry completes it", async () => {
    const id = await organizationWithRows("delete-faults");
    const member = rowsNaming(id).find(
      (row) => row.spec?.relation === "member",
    );
    faultingDelete = member?.metadata?.id;

    const failed = await grpcError(() =>
      organizations.delete({ value: "delete-faults" }),
    );

    expect(failed.code).toBe(Code.Internal);
    expect(failed.rawMessage).toBe(
      "failed to remove the organization's access policies",
    );
    expect(
      (await organizationQuery.get({ value: "delete-faults" })).metadata?.id,
    ).toBe(id);
    expect(await server.store.organizationDeletions.isDeleting(id)).toBe(false);
    // The agent's scope link went first; the revocation stopped at the
    // member row, before the owner row the retry needs.
    expect(
      rowsNaming(id)
        .map((row) => row.spec?.relation)
        .sort(),
    ).toEqual(["member", "owner"]);

    faultingDelete = undefined;
    await organizations.delete({ value: "delete-faults" });
    expect(rowsNaming(id)).toEqual([]);
    await purged(id);
  });

  it("a create of a deleted organization's slug makes a new organization that no old row names", async () => {
    const before = await organizationWithRows("delete-reborn");
    await organizations.delete({ value: "delete-reborn" });
    await purged(before);

    const reborn = await organizations.create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: "delete-reborn", slug: "delete-reborn", org: "" },
      spec: { description: "the slug, taken again" },
    });

    const after = reborn.metadata?.id ?? "";
    expect(after).not.toBe(before);
    expect(rowsNaming(before)).toEqual([]);
    expect(
      rowsNaming(after).map((row) => row.spec?.relation),
      "only the new creator's owner row",
    ).toEqual(["owner"]);
    expect(
      (await organizationQuery.get({ value: "delete-reborn" })).metadata?.id,
    ).toBe(after);
  });
});
