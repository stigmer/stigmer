// Conformance suite for the Organization domain.
// Domain: tenancy / organization.
//
// Drives OrganizationCommandController + OrganizationQueryController through the
// raw proto stubs. Covers CRUD round-trips, list pagination, and the
// capability-gated RPCs that differ between local OSS and cloud
// (listMine filtering). Child organizations are
// child-organizations.conformance.test.ts's. An
// organization's permanent id, its renamable slug and what a later holder of
// a released slug can reach are organization-identity.conformance.test.ts's.
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "../support/naming";
import { createTarget, enforcingLaneOf, type TargetProfile } from "../targets";

const API_VERSION = "tenancy.stigmer.ai/v1";
const KIND = "Organization";

let target: TargetProfile;
// Read at collection time so an edition without a capability reports its cases
// SKIPPED (the conformance guide's rule), never as passes that returned early.
const capabilities = createTarget().capabilities;
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

// Organizations are the top-level tenant, so they carry no parent org; the
// server mints their id, and the slug (derived from name) is a unique name.
// An organization the caller creates and therefore owns; deleted at the end
// of the arm. `using` defaults to the primary caller; the enforcing-lane arm
// hands the lane's founder, whose server the rows must live on.
async function createOrg(name: string, using: ConformanceClients = clients) {
  const org = await using.organizationCommand.create({
    apiVersion: API_VERSION,
    kind: KIND,
    metadata: { name },
  });
  fixtures.defer(() => using.organizationCommand.delete({ value: org.metadata!.id }));
  return org;
}

describe("Organization conformance", () => {
  it("[rpc:OrganizationCommandController.create] create mints an org_ id apart from the slug and records a created audit event", async () => {
    const created = await createOrg(uniqueName("org"));

    expect(created.metadata?.id, "the server mints the organization's id").toMatch(/^org_[0-9a-z]{26}$/);
    expect(created.metadata?.id).not.toBe(created.metadata?.slug);
    expect(created.metadata?.org, "an organization belongs to no organization").toBe("");
    expect(created.status?.audit?.specAudit?.event).toBe("created");
  });

  it("[rpc:OrganizationCommandController.apply] apply creates on first call and updates on second (same name)", async () => {
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

  it("[rpc:OrganizationCommandController.update] update preserves id and slug but allows a new display name", async () => {
    const created = await createOrg(uniqueName("org"));
    const { id, slug } = created.metadata!;

    const renamed = uniqueName("org-renamed");
    const updated = await clients.organizationCommand.update({ resource: {
      apiVersion: API_VERSION,
      kind: KIND,
      metadata: { id, name: renamed, slug: "attempted-different-slug" },
    }, updateMask: { paths: ["*"] } });

    expect(updated.metadata?.id).toBe(id);
    expect(updated.metadata?.slug).toBe(slug);
    expect(updated.metadata?.name).toBe(renamed);
    expect(updated.status?.audit?.specAudit?.event).toBe("updated");
  });

  it("[rpc:OrganizationQueryController.get] [rpc:OrganizationCommandController.delete] get returns the created organization and delete makes it NotFound", async () => {
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

  // Membership filtering is asserted on the enforcing lane below.
  it.skipIf(capabilities.enforcingAuthorizer)("[rpc:OrganizationQueryController.listMine] listMine pages every organization on a trusted-local primary", async () => {
    const created = [];
    for (let i = 0; i < 3; i++) {
      created.push((await createOrg(uniqueName("myorg"))).metadata!.id);
    }

    // A trusted-local primary applies no membership filter, so every
    // organization is the caller's; the walk follows tokens to the end
    // because the shared store may hold more than one page of them.
    const seen: string[] = [];
    let pageToken = "";
    do {
      const page = await clients.organizationQuery.listMine({ pageSize: 100, pageToken });
      seen.push(...page.entries.map((entry) => entry.metadata!.id));
      pageToken = page.nextPageToken;
    } while (pageToken !== "");

    expect(new Set(seen).size, "no organization appears twice").toBe(seen.length);
    for (const id of created) {
      expect(seen, "local mode applies no IAM filtering").toContain(id);
    }
  });

  // On the target's ENFORCING LANE (targets/target.ts): the cloud's primary,
  // and on the managed local targets an open-source sibling in the OIDC
  // posture, whose built-in organization directory answers
  // listMine and whose built-in Authorizer refuses the outsider's
  // `get` — one contract on the cloud and on both open-source store drivers.
  // Where a target lends no lane the arm skips VISIBLY.
  it("[rpc:OrganizationQueryController.listMine] [rpc:OrganizationQueryController.get] listMine filters by membership and outsiders cannot view the org", async (ctx) => {
    const enforcing = await enforcingLaneOf(target);
    if (enforcing.lane === undefined) return ctx.skip(enforcing.reason);
    const lane = enforcing.lane;
    const created = await createOrg(uniqueName("myorg"), lane.clients);
    const id = created.metadata!.id;

    const mine = await lane.clients.organizationQuery.listMine({});
    expect(
      mine.entries.some((entry) => entry.metadata?.id === id),
      "the creator (owner) must see the org in listMine",
    ).toBe(true);

    const outsider = await lane.provisionIdentity();
    const theirs = await outsider.organizationQuery.listMine({});
    expect(
      theirs.entries.some((entry) => entry.metadata?.id === id),
      "an identity with no grants must not see the org in listMine",
    ).toBe(false);

    await expectGrpcCode(
      () => outsider.organizationQuery.get({ value: id }),
      Code.PermissionDenied,
      "outsider get on a foreign org",
    );
  });

  it("[rpc:OrganizationCommandController.create] rejects an organization with an invalid (uppercase) slug", async () => {
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
