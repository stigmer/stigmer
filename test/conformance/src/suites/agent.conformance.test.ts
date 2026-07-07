// Conformance suite for the Agent domain.
// Domain: agentic / agent — a flat (non-versioned) blueprint resource.
//
// Drives AgentCommandController + AgentQueryController through the raw proto
// stubs and asserts the contract: CRUD round-trips, apply create/update
// branching, immutable identity fields, default-instance provisioning, reference
// resolution, slug semantics, spec-first negative paths, and — the headline of
// this slice — the cross-aggregate Agent->McpServer reference invariant.
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import { assertResourceParity } from "../contract/parity";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { AGENT_API_VERSION, AGENT_KIND, makeAgent, makeAgentSpec } from "../support/agents";
import { makeMcpServer } from "../support/mcpservers";
import { uniqueName } from "../support/naming";
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

async function createAgent(org: string, name: string, opts: { description?: string; mcpServerRefs?: string[] } = {}) {
  const agent = await clients.agentCommand.create(makeAgent({ org, name, ...opts }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return agent;
}

describe("Agent conformance — CRUD & identity", () => {
  it("create assigns an agt_ id, echoes the spec, records a created audit event, and provisions a default instance", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("agent");

    const created = await createAgent(org, name, { description: "code reviewer" });

    expect(created.metadata?.id, "create should assign a prefixed id").toMatch(/^agt_[0-9a-z]+$/);
    expect(created.metadata?.name).toBe(name);
    expect(created.metadata?.org).toBe(org);
    expect(created.spec?.description).toBe("code reviewer");
    expect(created.status?.audit?.specAudit?.event).toBe("created");
    expect(created.status?.defaultInstanceId, "create provisions a default instance").toMatch(/^ain_[0-9a-z]+$/);
  });

  it("creates an agent without a spec (spec is optional at the proto level)", async () => {
    const { org } = await target.provisionTenancy();
    // Unlike Project, AgentSpec is not `required`; a spec-less agent is a valid
    // (if minimal) blueprint. This documents that part of the contract.
    const created = await clients.agentCommand.create({
      apiVersion: AGENT_API_VERSION,
      kind: AGENT_KIND,
      metadata: { name: uniqueName("nospec"), org },
    });
    fixtures.defer(() => clients.agentCommand.delete({ value: created.metadata!.id }));

    expect(created.metadata?.id).toMatch(/^agt_[0-9a-z]+$/);
    expect(created.status?.audit?.specAudit?.event).toBe("created");
  });

  it("get round-trips the created resource (ignoring server-set fields)", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createAgent(org, uniqueName("agent"));

    const fetched = await clients.agentQuery.get({ value: created.metadata!.id });

    expect(fetched.metadata?.id).toBe(created.metadata?.id);
    assertResourceParity(AgentSchema, created, fetched, "create vs get");
  });

  it("apply creates on first call and updates on second (same name + org)", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("agent");

    const first = await clients.agentCommand.apply(makeAgent({ org, name, description: "v1" }));
    fixtures.defer(() => clients.agentCommand.delete({ value: first.metadata!.id }));
    expect(first.status?.audit?.specAudit?.event).toBe("created");

    const second = await clients.agentCommand.apply(makeAgent({ org, name, description: "v2" }));

    expect(second.metadata?.id, "apply must update the same resource").toBe(first.metadata?.id);
    expect(second.spec?.description).toBe("v2");
    expect(second.status?.audit?.specAudit?.event).toBe("updated");
  });

  it("update replaces spec and name but preserves id, slug, and org", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createAgent(org, uniqueName("agent"), { description: "before" });
    const { id, slug } = created.metadata!;

    const renamed = uniqueName("renamed");
    const updated = await clients.agentCommand.update({
      apiVersion: AGENT_API_VERSION,
      kind: AGENT_KIND,
      // Attempts to mutate slug/org must be ignored; only name and spec change.
      metadata: { id, name: renamed, slug: "attempted-different-slug", org: "attempted-different-org" },
      spec: makeAgentSpec({ description: "after" }),
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
    const created = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent") }));
    const { id } = created.metadata!;

    const deleted = await clients.agentCommand.delete({ value: id });
    expect(deleted.metadata?.id).toBe(id);

    await expectGrpcCode(() => clients.agentQuery.get({ value: id }), Code.NotFound, "get after delete");
  });

  it("get rejects an empty id with InvalidArgument", () =>
    expectGrpcCode(() => clients.agentQuery.get({ value: "" }), Code.InvalidArgument, "get empty id"));

  it("get of a missing id returns NotFound", () =>
    expectGrpcCode(() => clients.agentQuery.get({ value: "agt_doesnotexist" }), Code.NotFound, "get missing id"));

  it("getByReference resolves by org and slug", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createAgent(org, uniqueName("ref"));

    const fetched = await clients.agentQuery.getByReference({ org, slug: created.metadata!.slug });

    expect(fetched.metadata?.id).toBe(created.metadata?.id);
  });

  it("getByReference of an unknown slug returns NotFound", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.agentQuery.getByReference({ org, slug: "does-not-exist" }),
      Code.NotFound,
      "getByReference unknown slug",
    );
  });

  it("derives a slug from the name", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createAgent(org, "My Agent #1 (Test)");
    expect(created.metadata?.slug).toBe("my-agent-1-test");
  });

  it("allows the same slug in different orgs", async () => {
    const a = await target.provisionTenancy();
    const b = await target.provisionTenancy();
    const name = uniqueName("shared");

    const inA = await createAgent(a.org, name);
    const inB = await createAgent(b.org, name);

    expect(inA.metadata?.slug).toBe(inB.metadata?.slug);
    expect(inA.metadata?.id).not.toBe(inB.metadata?.id);
  });
});

describe("Agent conformance — negative paths", () => {
  it("rejects instructions shorter than the minimum length (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    // AgentSpec.instructions has min_len=10; a present-but-too-short value is a
    // Layer-1 protovalidate violation caught by ValidateProtoStep.
    await expectGrpcCode(
      () =>
        clients.agentCommand.create({
          apiVersion: AGENT_API_VERSION,
          kind: AGENT_KIND,
          metadata: { name: uniqueName("short"), org },
          spec: makeAgentSpec({ instructions: "too short" }),
        }),
      Code.InvalidArgument,
      "create with short instructions",
    );
  });

  it("getDefault returns NotFound when no default agent is configured", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(() => clients.agentQuery.getDefault({ org }), Code.NotFound, "getDefault without a default");
  });

  it("rejects a duplicate create (contract: AlreadyExists)", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("dup");
    await createAgent(org, name);

    await expectGrpcCode(
      () => clients.agentCommand.create(makeAgent({ org, name })),
      Code.AlreadyExists,
      "duplicate create",
    );
  });

  it("rejects a create with no name (contract: InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    // Spec is valid so Layer 1 passes; the empty name is what must be rejected
    // (slug resolution has nothing to derive from).
    await expectGrpcCode(
      () =>
        clients.agentCommand.create({
          apiVersion: AGENT_API_VERSION,
          kind: AGENT_KIND,
          metadata: { org },
          spec: makeAgentSpec(),
        }),
      Code.InvalidArgument,
      "create without name",
    );
  });
});

describe("Agent conformance — McpServer references", () => {
  it("accepts an agent referencing an existing McpServer and normalizes the reference org", async () => {
    const { org } = await target.provisionTenancy();
    const mcpServer = await clients.mcpServerCommand.create(makeMcpServer({ org, name: uniqueName("tools") }));
    fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: mcpServer.metadata!.id }));
    const mcpSlug = mcpServer.metadata!.slug;

    const agent = await createAgent(org, uniqueName("agent"), { mcpServerRefs: [mcpSlug] });

    const usages = agent.spec?.mcpServerUsages ?? [];
    expect(usages, "the referenced MCP server is preserved on the agent").toHaveLength(1);
    expect(usages[0]?.mcpServerRef?.slug).toBe(mcpSlug);
    // The request left org empty; NormalizeReferences resolves it to the agent's org.
    expect(usages[0]?.mcpServerRef?.org, "the empty reference org is normalized to the agent's org").toBe(org);
  });

  it("rejects an agent referencing a non-existent McpServer (FailedPrecondition)", async () => {
    const { org } = await target.provisionTenancy();
    const missingSlug = "ghost-mcp-server";

    const err = await expectGrpcCode(
      () => clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent"), mcpServerRefs: [missingSlug] })),
      Code.FailedPrecondition,
      "create agent with missing MCP server reference",
    );
    expect(err.message, "the error names the missing MCP server slug").toContain(missingSlug);
  });
});
