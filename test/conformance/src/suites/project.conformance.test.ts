// Conformance suite for the Project domain.
// Domain: tenancy / project.
//
// Drives ProjectCommandController + ProjectQueryController through the raw proto
// stubs and asserts the contract: CRUD round-trips, apply create/update
// branching, immutable identity fields, reference resolution, slug semantics,
// and spec-first negative paths.
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ProjectSchema } from "@stigmer/protos/ai/stigmer/tenancy/project/v1/api_pb";
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectCodeOrDeviation } from "../contract/deviations";
import { expectGrpcCode } from "../contract/errors";
import { assertResourceParity } from "../contract/parity";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

const API_VERSION = "tenancy.stigmer.ai/v1";
const KIND = "Project";

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

async function createProject(org: string, name: string, description = "conformance fixture") {
  const project = await clients.projectCommand.create({
    apiVersion: API_VERSION,
    kind: KIND,
    metadata: { name, org },
    spec: { description },
  });
  fixtures.defer(() => clients.projectCommand.delete({ value: project.metadata!.id }));
  return project;
}

describe("Project conformance", () => {
  it("create assigns a prj_ id, echoes the spec, and records a created audit event", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("proj");

    const created = await createProject(org, name, "hello");

    expect(created.metadata?.id, "create should assign a prefixed id").toMatch(/^prj_[0-9a-z]+$/);
    expect(created.metadata?.name).toBe(name);
    expect(created.metadata?.org).toBe(org);
    expect(created.spec?.description).toBe("hello");
    expect(created.status?.audit?.specAudit?.event).toBe("created");
  });

  it("get round-trips the created resource (ignoring server-set fields)", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createProject(org, uniqueName("proj"));

    const fetched = await clients.projectQuery.get({ value: created.metadata!.id });

    expect(fetched.metadata?.id).toBe(created.metadata?.id);
    assertResourceParity(ProjectSchema, created, fetched, "create vs get");
  });

  it("apply creates on first call and updates on second (same name + org)", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("proj");

    const first = await clients.projectCommand.apply({
      apiVersion: API_VERSION,
      kind: KIND,
      metadata: { name, org },
      spec: { description: "v1" },
    });
    fixtures.defer(() => clients.projectCommand.delete({ value: first.metadata!.id }));
    expect(first.status?.audit?.specAudit?.event).toBe("created");

    const second = await clients.projectCommand.apply({
      apiVersion: API_VERSION,
      kind: KIND,
      metadata: { name, org },
      spec: { description: "v2" },
    });

    expect(second.metadata?.id, "apply must update the same resource").toBe(first.metadata?.id);
    expect(second.spec?.description).toBe("v2");
    expect(second.status?.audit?.specAudit?.event).toBe("updated");
  });

  it("update replaces spec and name but preserves id, slug, and org", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createProject(org, uniqueName("proj"), "before");
    const { id, slug } = created.metadata!;

    const renamed = uniqueName("renamed");
    const updated = await clients.projectCommand.update({
      apiVersion: API_VERSION,
      kind: KIND,
      // Attempts to mutate slug/org must be ignored; only name and spec change.
      metadata: { id, name: renamed, slug: "attempted-different-slug", org: "attempted-different-org" },
      spec: { description: "after" },
    });

    expect(updated.metadata?.id).toBe(id);
    expect(updated.metadata?.slug).toBe(slug);
    expect(updated.metadata?.org).toBe(org);
    expect(updated.metadata?.name).toBe(renamed);
    expect(updated.spec?.description).toBe("after");
    expect(updated.status?.audit?.specAudit?.event).toBe("updated");
  });

  it("delete returns the resource and a subsequent get reports NotFound", async () => {
    const { org } = await target.provisionTenancy();
    const created = await clients.projectCommand.create({
      apiVersion: API_VERSION,
      kind: KIND,
      metadata: { name: uniqueName("proj"), org },
      spec: { description: "to delete" },
    });
    const { id } = created.metadata!;

    const deleted = await clients.projectCommand.delete({ value: id });
    expect(deleted.metadata?.id).toBe(id);

    await expectGrpcCode(() => clients.projectQuery.get({ value: id }), Code.NotFound, "get after delete");
  });

  it("get rejects an empty id with InvalidArgument", () =>
    expectGrpcCode(() => clients.projectQuery.get({ value: "" }), Code.InvalidArgument, "get empty id"));

  it("get of a missing id returns NotFound", () =>
    expectGrpcCode(() => clients.projectQuery.get({ value: "prj_doesnotexist" }), Code.NotFound, "get missing id"));

  it("getByReference resolves by org and slug", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createProject(org, uniqueName("ref"));

    const fetched = await clients.projectQuery.getByReference({ org, slug: created.metadata!.slug });

    expect(fetched.metadata?.id).toBe(created.metadata?.id);
  });

  it("getByReference with empty org returns the slug match", async () => {
    const { org } = await target.provisionTenancy();
    // A unique slug guarantees a single global match for the empty-org lookup.
    const created = await createProject(org, uniqueName("solo"));

    const fetched = await clients.projectQuery.getByReference({ slug: created.metadata!.slug });

    expect(fetched.metadata?.id).toBe(created.metadata?.id);
  });

  it("getByReference rejects a kind that does not match the service", () =>
    expectGrpcCode(
      () => clients.projectQuery.getByReference({ org: "acme", slug: "web-search", kind: ApiResourceKind.agent }),
      Code.InvalidArgument,
      "getByReference kind mismatch",
    ));

  it("derives a slug from the name", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createProject(org, "My Project #1 (Test)");
    expect(created.metadata?.slug).toBe("my-project-1-test");
  });

  it("allows the same slug in different orgs", async () => {
    const a = await target.provisionTenancy();
    const b = await target.provisionTenancy();
    const name = uniqueName("shared");

    const inA = await createProject(a.org, name);
    const inB = await createProject(b.org, name);

    expect(inA.metadata?.slug).toBe(inB.metadata?.slug);
    expect(inA.metadata?.id).not.toBe(inB.metadata?.id);
  });

  it("rejects a project without a spec (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.projectCommand.create({ apiVersion: API_VERSION, kind: KIND, metadata: { name: uniqueName("nospec"), org } }),
      Code.InvalidArgument,
      "create without spec",
    );
  });

  it("rejects a duplicate create (contract: AlreadyExists)", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("dup");
    await createProject(org, name);

    await expectCodeOrDeviation(
      target.name,
      "create.duplicate.code",
      () =>
        clients.projectCommand.create({
          apiVersion: API_VERSION,
          kind: KIND,
          metadata: { name, org },
          spec: { description: "second" },
        }),
      "duplicate create",
    );
  });

  it("rejects a create with no name (contract: InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    // Spec is present so validation passes; the empty name is what must be
    // rejected (slug resolution has nothing to derive from).
    await expectCodeOrDeviation(
      target.name,
      "create.missing-name.code",
      () => clients.projectCommand.create({ apiVersion: API_VERSION, kind: KIND, metadata: { org }, spec: { description: "x" } }),
      "create without name",
    );
  });
});
