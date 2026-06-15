// Conformance suite for the McpServer domain.
// Domain: agentic / mcpserver — a flat (non-versioned) blueprint resource.
//
// Drives McpServerCommandController + McpServerQueryController through the raw
// proto stubs and asserts the contract: CRUD round-trips, apply create/update
// branching, immutable identity fields, reference resolution, slug semantics,
// and spec-first negative paths.
//
// NOTE: this is distinct from mcp.conformance.test.ts, which exercises the
// @stigmer/mcp-server *bridge* (its MCP tool surface). This suite tests the
// McpServer *domain* — the first-class resource and its gRPC controllers.
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectCodeOrDeviation } from "../contract/deviations";
import { expectGrpcCode } from "../contract/errors";
import { assertResourceParity } from "../contract/parity";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "../support/naming";
import { MCPSERVER_API_VERSION, MCPSERVER_KIND, makeMcpServer, makeMcpServerSpec } from "../support/mcpservers";
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

async function createMcpServer(org: string, name: string, description = "conformance fixture") {
  const mcpServer = await clients.mcpServerCommand.create(makeMcpServer({ org, name, description }));
  fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: mcpServer.metadata!.id }));
  return mcpServer;
}

describe("McpServer conformance — CRUD & identity", () => {
  it("create assigns an mcp_ id, echoes the spec, and records a created audit event", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("mcp");

    const created = await createMcpServer(org, name, "github operations");

    expect(created.metadata?.id, "create should assign a prefixed id").toMatch(/^mcp_[0-9a-z]+$/);
    expect(created.metadata?.name).toBe(name);
    expect(created.metadata?.org).toBe(org);
    expect(created.spec?.description).toBe("github operations");
    expect(created.spec?.serverType.case).toBe("stdio");
    expect(created.status?.audit?.specAudit?.event).toBe("created");
  });

  it("get round-trips the created resource (ignoring server-set fields)", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createMcpServer(org, uniqueName("mcp"));

    const fetched = await clients.mcpServerQuery.get({ value: created.metadata!.id });

    expect(fetched.metadata?.id).toBe(created.metadata?.id);
    assertResourceParity(McpServerSchema, created, fetched, "create vs get");
  });

  it("apply creates on first call and updates on second (same name + org)", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("mcp");

    const first = await clients.mcpServerCommand.apply(makeMcpServer({ org, name, description: "v1" }));
    fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: first.metadata!.id }));
    expect(first.status?.audit?.specAudit?.event).toBe("created");

    const second = await clients.mcpServerCommand.apply(makeMcpServer({ org, name, description: "v2" }));

    expect(second.metadata?.id, "apply must update the same resource").toBe(first.metadata?.id);
    expect(second.spec?.description).toBe("v2");
    expect(second.status?.audit?.specAudit?.event).toBe("updated");
  });

  it("update replaces spec and name but preserves id, slug, and org", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createMcpServer(org, uniqueName("mcp"), "before");
    const { id, slug } = created.metadata!;

    const renamed = uniqueName("renamed");
    const updated = await clients.mcpServerCommand.update({
      apiVersion: MCPSERVER_API_VERSION,
      kind: MCPSERVER_KIND,
      // Attempts to mutate slug/org must be ignored; only name and spec change.
      metadata: { id, name: renamed, slug: "attempted-different-slug", org: "attempted-different-org" },
      spec: makeMcpServerSpec({ description: "after" }),
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
    const created = await clients.mcpServerCommand.create(makeMcpServer({ org, name: uniqueName("mcp") }));
    const { id } = created.metadata!;

    const deleted = await clients.mcpServerCommand.delete({ resourceId: id });
    expect(deleted.metadata?.id).toBe(id);

    await expectGrpcCode(() => clients.mcpServerQuery.get({ value: id }), Code.NotFound, "get after delete");
  });

  it("get rejects an empty id with InvalidArgument", () =>
    expectGrpcCode(() => clients.mcpServerQuery.get({ value: "" }), Code.InvalidArgument, "get empty id"));

  it("get of a missing id returns NotFound", () =>
    expectGrpcCode(() => clients.mcpServerQuery.get({ value: "mcp_doesnotexist" }), Code.NotFound, "get missing id"));

  it("getByReference resolves by org and slug", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createMcpServer(org, uniqueName("ref"));

    const fetched = await clients.mcpServerQuery.getByReference({ org, slug: created.metadata!.slug });

    expect(fetched.metadata?.id).toBe(created.metadata?.id);
  });

  it("getByReference of an unknown slug returns NotFound", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.mcpServerQuery.getByReference({ org, slug: "does-not-exist" }),
      Code.NotFound,
      "getByReference unknown slug",
    );
  });

  it("derives a slug from the name", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createMcpServer(org, "My MCP Server #1 (Test)");
    expect(created.metadata?.slug).toBe("my-mcp-server-1-test");
  });

  it("allows the same slug in different orgs", async () => {
    const a = await target.provisionTenancy();
    const b = await target.provisionTenancy();
    const name = uniqueName("shared");

    const inA = await createMcpServer(a.org, name);
    const inB = await createMcpServer(b.org, name);

    expect(inA.metadata?.slug).toBe(inB.metadata?.slug);
    expect(inA.metadata?.id).not.toBe(inB.metadata?.id);
  });
});

describe("McpServer conformance — negative paths", () => {
  it("rejects a spec with no server_type (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    // The server_type oneof is required; a spec present but without stdio/http
    // is a Layer-1 protovalidate violation caught by ValidateProtoStep.
    await expectGrpcCode(
      () =>
        clients.mcpServerCommand.create({
          apiVersion: MCPSERVER_API_VERSION,
          kind: MCPSERVER_KIND,
          metadata: { name: uniqueName("notype"), org },
          spec: { description: "no server type set" },
        }),
      Code.InvalidArgument,
      "create without server_type",
    );
  });

  it("rejects a stdio server with an empty command (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    // stdio.command is required (min_len=1).
    await expectGrpcCode(
      () =>
        clients.mcpServerCommand.create({
          apiVersion: MCPSERVER_API_VERSION,
          kind: MCPSERVER_KIND,
          metadata: { name: uniqueName("nocmd"), org },
          spec: { serverType: { case: "stdio", value: { command: "" } } },
        }),
      Code.InvalidArgument,
      "create with empty stdio command",
    );
  });

  it("rejects an http server with a non-URI url (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    // http.url is required and must be a valid URI.
    await expectGrpcCode(
      () =>
        clients.mcpServerCommand.create({
          apiVersion: MCPSERVER_API_VERSION,
          kind: MCPSERVER_KIND,
          metadata: { name: uniqueName("badurl"), org },
          spec: { serverType: { case: "http", value: { url: "not a url" } } },
        }),
      Code.InvalidArgument,
      "create with non-URI http url",
    );
  });

  it("rejects a duplicate create (contract: AlreadyExists)", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("dup");
    await createMcpServer(org, name);

    await expectCodeOrDeviation(
      target.name,
      "create.duplicate.code",
      () => clients.mcpServerCommand.create(makeMcpServer({ org, name })),
      "duplicate create",
    );
  });

  it("rejects a create with no name (contract: InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    // Spec is valid so Layer 1 passes; the empty name is what must be rejected
    // (slug resolution has nothing to derive from).
    await expectCodeOrDeviation(
      target.name,
      "create.missing-name.code",
      () =>
        clients.mcpServerCommand.create({
          apiVersion: MCPSERVER_API_VERSION,
          kind: MCPSERVER_KIND,
          metadata: { org },
          spec: makeMcpServerSpec(),
        }),
      "create without name",
    );
  });
});
