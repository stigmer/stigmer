// Conformance suite for the Organization domain.
// Domain: tenancy / organization.
//
// Drives OrganizationCommandController + OrganizationQueryController through the
// raw proto stubs. Covers CRUD round-trips, list pagination, and the
// capability-gated RPCs that differ between local OSS and cloud
// (findMyOrganizations filtering, getByExternalOrgId availability).
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

const API_VERSION = "tenancy.stigmer.ai/v1";
const KIND = "Organization";

// FindApiResourcesRequest.org is required by protovalidate, but the organization
// Find ignores it for filtering (organizations are the top-level scope). The
// contract still demands a non-empty value, so we pass a stable placeholder.
const FIND_ORG = "conformance";

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

// Organizations are the top-level tenant, so they carry no parent org; the slug
// (derived from name) is their unique key.
async function createOrg(name: string) {
  const org = await clients.organizationCommand.create({
    apiVersion: API_VERSION,
    kind: KIND,
    metadata: { name },
  });
  fixtures.defer(() => clients.organizationCommand.delete({ value: org.metadata!.id }));
  return org;
}

async function countOrganizations(): Promise<number> {
  const list = await clients.organizationQuery.find({ org: FIND_ORG, pageSize: 100 });
  return list.entries.length;
}

describe("Organization conformance", () => {
  it("create assigns an org_ id and records a created audit event", async () => {
    const created = await createOrg(uniqueName("org"));

    expect(created.metadata?.id, "create should assign a prefixed id").toMatch(/^org_[0-9a-z]+$/);
    expect(created.status?.audit?.specAudit?.event).toBe("created");
  });

  it("apply creates on first call and updates on second (same name)", async () => {
    const name = uniqueName("org");

    const first = await clients.organizationCommand.apply({ apiVersion: API_VERSION, kind: KIND, metadata: { name } });
    fixtures.defer(() => clients.organizationCommand.delete({ value: first.metadata!.id }));
    expect(first.status?.audit?.specAudit?.event).toBe("created");

    const second = await clients.organizationCommand.apply({
      apiVersion: API_VERSION,
      kind: KIND,
      metadata: { name },
      spec: { description: "updated" },
    });

    expect(second.metadata?.id).toBe(first.metadata?.id);
    expect(second.spec?.description).toBe("updated");
    expect(second.status?.audit?.specAudit?.event).toBe("updated");
  });

  it("update preserves id and slug but allows renaming", async () => {
    const created = await createOrg(uniqueName("org"));
    const { id, slug } = created.metadata!;

    const renamed = uniqueName("org-renamed");
    const updated = await clients.organizationCommand.update({
      apiVersion: API_VERSION,
      kind: KIND,
      metadata: { id, name: renamed, slug: "attempted-different-slug" },
    });

    expect(updated.metadata?.id).toBe(id);
    expect(updated.metadata?.slug).toBe(slug);
    expect(updated.metadata?.name).toBe(renamed);
    expect(updated.status?.audit?.specAudit?.event).toBe("updated");
  });

  it("get returns the created organization and delete makes it NotFound", async () => {
    const created = await clients.organizationCommand.create({
      apiVersion: API_VERSION,
      kind: KIND,
      metadata: { name: uniqueName("org") },
    });
    const { id } = created.metadata!;

    const fetched = await clients.organizationQuery.get({ value: id });
    expect(fetched.metadata?.id).toBe(id);

    await clients.organizationCommand.delete({ value: id });
    await expectGrpcCode(() => clients.organizationQuery.get({ value: id }), Code.NotFound, "get after delete");
  });

  it("find lists created organizations with correct pagination", async () => {
    const baseline = await countOrganizations();
    const added = 3;
    for (let i = 0; i < added; i++) {
      await createOrg(uniqueName("findorg"));
    }

    const total = baseline + added;
    expect(await countOrganizations(), "find should return every organization").toBe(total);

    const pageSize = 2;
    const firstPage = await clients.organizationQuery.find({ org: FIND_ORG, pageSize });
    expect(firstPage.entries.length).toBeLessThanOrEqual(pageSize);
    expect(firstPage.totalPages).toBe(Math.ceil(total / pageSize));
  });

  it("findMyOrganizations returns all organizations when multi-tenancy is off", async () => {
    if (target.capabilities.multiTenant) {
      // Membership filtering is asserted by the multi-tenant test below.
      return;
    }
    await createOrg(uniqueName("myorg"));

    const all = await clients.organizationQuery.find({ org: FIND_ORG, pageSize: 100 });
    const mine = await clients.organizationQuery.findMyOrganizations({});

    expect(mine.entries.length, "local mode applies no IAM filtering").toBe(all.entries.length);
  });

  it("findMyOrganizations filters by membership and outsiders cannot view the org", async () => {
    if (!target.capabilities.multiTenant) {
      // Single-tenant targets have one implicit caller; there is no second
      // identity to be excluded, so isolation is untestable by construction.
      return;
    }
    if (target.provisionIdentity === undefined) {
      throw new Error(`target "${target.name}" declares multiTenant but provides no provisionIdentity()`);
    }
    const created = await createOrg(uniqueName("myorg"));
    const id = created.metadata!.id;

    const mine = await clients.organizationQuery.findMyOrganizations({});
    expect(
      mine.entries.some((entry) => entry.metadata?.id === id),
      "the creator (owner) must see the org in findMyOrganizations",
    ).toBe(true);

    const outsider = await target.provisionIdentity();
    const theirs = await outsider.organizationQuery.findMyOrganizations({});
    expect(
      theirs.entries.some((entry) => entry.metadata?.id === id),
      "an identity with no grants must not see the org in findMyOrganizations",
    ).toBe(false);

    await expectGrpcCode(
      () => outsider.organizationQuery.get({ value: id }),
      Code.PermissionDenied,
      "outsider get on a foreign org",
    );
  });

  it("getByExternalOrgId is unavailable locally (Unimplemented)", async () => {
    if (target.capabilities.externalOrgLookup) {
      return;
    }
    await expectGrpcCode(
      () =>
        clients.organizationQuery.getByExternalOrgId({
          externalOrgId: "ext-123",
          identityProviderRef: { org: "acme", slug: "idp-test" },
        }),
      Code.Unimplemented,
      "getByExternalOrgId",
    );
  });

  it("getByExternalOrgId answers NotFound for an unknown identity provider when implemented", async () => {
    if (!target.capabilities.externalOrgLookup) {
      return;
    }
    const { org } = await target.provisionTenancy();

    // Minimum-viable contract for the implemented RPC: the lookup pipeline is
    // reachable (not Unimplemented) and an unknown IdentityProvider reference
    // is NotFound. The IdP-backed happy path (platform-managed org resolved by
    // real external coordinates) needs full IdentityProvider provisioning and
    // is deferred with the rest of the federation surface.
    await expectGrpcCode(
      () =>
        clients.organizationQuery.getByExternalOrgId({
          externalOrgId: "ext-123",
          identityProviderRef: { org, slug: "idp-does-not-exist" },
        }),
      Code.NotFound,
      "getByExternalOrgId with unknown identity provider",
    );
  });

  it("rejects an organization with an invalid (uppercase) slug", async () => {
    await expectGrpcCode(
      () =>
        clients.organizationCommand.create({
          apiVersion: API_VERSION,
          kind: KIND,
          metadata: { name: uniqueName("badslug"), slug: "BadSlug" },
        }),
      Code.InvalidArgument,
      "uppercase slug",
    );
  });
});
