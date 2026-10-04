// Conformance suite for an organization's identity: a permanent id the server
// mints, and a slug that is a name the organization answers to and can change.
// Domain: tenancy / organization, and every org-scoped kind that names one.
//
// The contract under test: every resource names its organization by id, so a
// request may name the organization by its id or its slug and the resource
// lands in the same place; a rename moves no resource, secret or grant, and
// the old slug keeps leading to the organization (and is refused to everyone
// else) until it is released; a deleted organization's slug is free, and the
// organization a later holder makes reaches nothing the deleted one owned.
//
// Environments carry the org-scoped arms because they hold a secret: a value
// written before a rename is revealed after it. The member and outsider arms
// run on the target's enforcing lane, where a grant is a real row; where a
// target lends no lane they skip visibly.
import { Code } from "@connectrpc/connect";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeEnvironment } from "../support/environments";
import { uniqueName } from "../support/naming";
import { createTarget, enforcingLaneOf, type TargetProfile } from "../targets";

const API_VERSION = "tenancy.stigmer.ai/v1";
const KIND = "Organization";
const MINTED_ORG_ID = /^org_[0-9a-z]{26}$/;
const SECRET = "the-secret-survives-the-rename";

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

/** An organization under a given slug, deleted at the end of the arm. */
async function createOrg(slug: string, using: ConformanceClients = clients) {
  const org = await using.organizationCommand.create({
    apiVersion: API_VERSION,
    kind: KIND,
    metadata: { name: slug, slug },
  });
  fixtures.defer(() => using.organizationCommand.delete({ value: org.metadata!.id }));
  return org;
}

/** An environment with one secret, in the organization `org` names (by id or slug). */
async function createSecretEnvironment(org: string, using: ConformanceClients = clients) {
  const environment = await using.environmentCommand.create(
    makeEnvironment({
      org,
      name: uniqueName("env"),
      data: { TOKEN: { value: SECRET, isSecret: true } },
    }),
  );
  fixtures.defer(() => using.environmentCommand.delete({ resourceId: environment.metadata!.id }));
  return environment;
}

describe("Organization identity conformance", () => {
  it("[rpc:OrganizationCommandController.create] [rpc:OrganizationQueryController.get] an organization is filed under a minted id, and its slug leads to it", async () => {
    const slug = uniqueName("ident");
    const created = await createOrg(slug);
    const id = created.metadata!.id;
    expect(id).toMatch(MINTED_ORG_ID);

    expect((await clients.organizationQuery.get({ value: slug })).metadata?.id).toBe(id);
    expect((await clients.organizationQuery.get({ value: id })).metadata?.slug).toBe(slug);

    // Named by slug, the resource is filed under the id, and found by either.
    const environment = await createSecretEnvironment(slug);
    expect(environment.metadata?.org, "a resource names its organization by id").toBe(id);
    for (const org of [slug, id]) {
      const found = await clients.environmentQuery.getByReference({ org, slug: environment.metadata!.slug });
      expect(found.metadata?.id, `found through org '${org}'`).toBe(environment.metadata?.id);
      const listed = await clients.environmentQuery.list({ org });
      expect(listed.items.map((item) => item.metadata?.id)).toContain(environment.metadata?.id);
    }
  });

  it("[rpc:OrganizationCommandController.rename] a rename keeps the id, every resource and every secret, and the old slug leads to the organization", async () => {
    const before = uniqueName("ident");
    const after = uniqueName("ident");
    const created = await createOrg(before);
    const id = created.metadata!.id;
    const environment = await createSecretEnvironment(before);

    const renamed = await clients.organizationCommand.rename({ resourceId: id, slug: after });
    expect(renamed.metadata?.id, "a rename keeps the id").toBe(id);
    expect(renamed.metadata?.slug).toBe(after);
    expect(renamed.status?.audit?.specAudit?.event).toBe("renamed");

    const revealed = await clients.environmentQuery.getSecretValue({
      environmentId: environment.metadata!.id,
      key: "TOKEN",
    });
    expect(revealed.value, "a secret written before the rename is read after it").toBe(SECRET);

    for (const org of [after, before]) {
      expect((await clients.organizationQuery.get({ value: org })).metadata?.slug, `get by '${org}'`).toBe(after);
      const found = await clients.environmentQuery.getByReference({ org, slug: environment.metadata!.slug });
      expect(found.metadata?.org, `the environment through org '${org}'`).toBe(id);
    }

    // A rename by the old slug finds the organization too.
    const viaOldSlug = await clients.organizationCommand.rename({ resourceId: before, slug: after });
    expect(viaOldSlug.metadata?.id).toBe(id);
  });

  it("[rpc:OrganizationCommandController.rename] [rpc:OrganizationCommandController.create] a renamed-away slug is refused to others until released, and its organization takes it back", async () => {
    const before = uniqueName("ident");
    const after = uniqueName("ident");
    const created = await createOrg(before);
    const id = created.metadata!.id;
    await clients.organizationCommand.rename({ resourceId: id, slug: after });

    const refused = await expectGrpcCode(
      () => clients.organizationCommand.create({ apiVersion: API_VERSION, kind: KIND, metadata: { name: before, slug: before } }),
      Code.AlreadyExists,
      "a create of a slug another organization was just renamed from",
    );
    const [reason] = refused.findDetails(ErrorInfoSchema);
    expect(reason?.reason).toBe("ORGANIZATION_SLUG_RESERVED");
    expect(reason?.domain).toBe("stigmer.ai");
    expect(reason?.metadata).toEqual({ slug: before });

    const other = await createOrg(uniqueName("ident"));
    await expectGrpcCode(
      () => clients.organizationCommand.rename({ resourceId: other.metadata!.id, slug: before }),
      Code.AlreadyExists,
      "a rename onto a slug another organization was just renamed from",
    );
    await expectGrpcCode(
      () => clients.organizationCommand.rename({ resourceId: other.metadata!.id, slug: after }),
      Code.AlreadyExists,
      "a rename onto another organization's slug",
    );

    const back = await clients.organizationCommand.rename({ resourceId: id, slug: before });
    expect(back.metadata?.slug, "an organization takes back its own old slug").toBe(before);
  });

  it("[rpc:OrganizationCommandController.delete] [rpc:OrganizationCommandController.create] a deleted organization's slug is free, and the next organization of it reaches nothing the deleted one owned", async () => {
    const slug = uniqueName("ident");
    const first = await clients.organizationCommand.create({ apiVersion: API_VERSION, kind: KIND, metadata: { name: slug, slug } });
    const environment = await createSecretEnvironment(slug);
    await clients.organizationCommand.delete({ value: first.metadata!.id });

    const second = await createOrg(slug);
    expect(second.metadata?.id, "a new organization, not the deleted one again").not.toBe(first.metadata?.id);

    const listed = await clients.environmentQuery.list({ org: slug });
    expect(listed.items, "the new organization holds none of the deleted one's environments").toEqual([]);
    await expectGrpcCode(
      () => clients.environmentQuery.getByReference({ org: slug, slug: environment.metadata!.slug }),
      Code.NotFound,
      "the deleted organization's environment, through the slug's new holder",
    );
  });

  it("[rpc:OrganizationCommandController.rename] a rename keeps every member's grant, and only an owner may rename", async (ctx) => {
    const enforcing = await enforcingLaneOf(target);
    if (enforcing.lane === undefined) return ctx.skip(enforcing.reason);
    const lane = enforcing.lane;
    const tenancy = await lane.provisionTenancy();
    fixtures.defer(() => lane.cleanupTenancy(tenancy));
    const member = await lane.provisionMember(tenancy);
    const before = (await lane.clients.organizationQuery.get({ value: tenancy.org })).metadata!.slug;
    const after = uniqueName("ident");

    await expectGrpcCode(
      () => member.organizationCommand.rename({ resourceId: tenancy.org, slug: after }),
      Code.PermissionDenied,
      "a member renaming the organization",
    );
    // An admin edits the organization but may not rename it: a rename moves
    // every member's links and scripts, an owner's decision.
    const admin = await lane.provisionWithRole(tenancy, "admin");
    await expectGrpcCode(
      () => admin.organizationCommand.rename({ resourceId: tenancy.org, slug: after }),
      Code.PermissionDenied,
      "an admin renaming the organization",
    );

    await lane.clients.organizationCommand.rename({ resourceId: tenancy.org, slug: after });

    for (const org of [after, before]) {
      expect((await member.organizationQuery.get({ value: org })).metadata?.id, `the member reads it by '${org}'`).toBe(
        tenancy.org,
      );
    }
    const theirs = await createSecretEnvironment(before, member);
    expect(theirs.metadata?.org, "the member still creates in it, by the old slug").toBe(tenancy.org);
  });

  it("[rpc:OrganizationCommandController.delete] a later holder of a deleted organization's slug gains nothing from it, and its founder holds nothing in the new one", async (ctx) => {
    const enforcing = await enforcingLaneOf(target);
    if (enforcing.lane === undefined) return ctx.skip(enforcing.reason);
    const lane = enforcing.lane;
    const slug = uniqueName("ident");
    const first = await lane.clients.organizationCommand.create({ apiVersion: API_VERSION, kind: KIND, metadata: { name: slug, slug } });
    const environment = await createSecretEnvironment(slug, lane.clients);
    await lane.clients.organizationCommand.delete({ value: first.metadata!.id });

    const stranger = await lane.provisionIdentity();
    const second = await createOrg(slug, stranger);
    expect(second.metadata?.id).not.toBe(first.metadata?.id);

    expect((await stranger.environmentQuery.list({ org: slug })).items).toEqual([]);
    await expectGrpcCode(
      () => stranger.environmentQuery.getByReference({ org: slug, slug: environment.metadata!.slug }),
      Code.NotFound,
      "the deleted organization's environment, by its old slug's new holder",
    );
    await expectGrpcCode(
      () => lane.clients.organizationQuery.get({ value: slug }),
      Code.PermissionDenied,
      "the deleted organization's founder, on the slug's new organization",
    );
  });
});
