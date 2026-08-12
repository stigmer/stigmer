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
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
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
    // Agent is a blueprint kind (defaults_to_org_visibility), so an
    // unspecified visibility defaults to org; private is an explicit opt-in.
    expect(created.metadata?.visibility, "visibility defaults to org (blueprint default)").toBe(ApiResourceVisibility.visibility_org);
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

  it("getByReference rejects a kind that does not match the service", () =>
    expectGrpcCode(
      () => clients.agentQuery.getByReference({ org: "acme", slug: "web-search", kind: ApiResourceKind.project }),
      Code.InvalidArgument,
      "getByReference kind mismatch",
    ));

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

describe("Agent conformance — platform default resolution", () => {
  const DEFAULT_AGENT_LABEL = "stigmer.ai/default-agent";

  // Creates a getDefault candidate: an agent carrying the platform default
  // label, flipped public via updateVisibility (agents create org-visible —
  // the blueprint default — and public is an explicit opt-in, the same lane
  // the skill suite pins). The label assert gives a crisp failure if an
  // edition ever strips labels at create, instead of an opaque NotFound later.
  //
  // NOTE: label writes ride the currently-unguarded stigmer.ai/* namespace
  // (stigmer-cloud#320 tracks guarding it at write boundaries); when a guard
  // lands, this helper must switch to a platform-privileged caller.
  async function createDefaultCandidate(org: string) {
    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("default-cand"), labels: { [DEFAULT_AGENT_LABEL]: "true" } }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
    expect(agent.metadata?.labels?.[DEFAULT_AGENT_LABEL], "the default-agent label survives create").toBe("true");

    const updated = await clients.agentCommand.updateVisibility({
      resourceId: agent.metadata!.id,
      visibility: ApiResourceVisibility.visibility_public,
    });
    expect(updated.metadata?.visibility).toBe(ApiResourceVisibility.visibility_public);
    return agent;
  }

  it("getDefault resolves the incumbent (first-created) when several public agents carry the label", async () => {
    const { org } = await target.provisionTenancy();

    // Two labeled public agents is the normal mid-rotation state: the new
    // default is applied before the old one is retired. The shared contract —
    // pinned resolver-side on both editions (OSS pkg/domain/agent/defaultagent,
    // stigmer#356 / PR #458; cloud PostgresAgentRepo.findDefault,
    // stigmer-cloud#319) — is incumbent-wins: the lowest metadata.id (server
    // ids are time-ordered ULIDs, so the first-created) keeps serving until
    // its label is removed. Label removal is the explicit rotation cutover.
    const incumbent = await createDefaultCandidate(org);
    const rotatedIn = await createDefaultCandidate(org);

    const resolved = await clients.agentQuery.getDefault({ org });

    // Two-step assert: first that the winner is one of THIS test's candidates
    // (a foreign winner means the environment carries a pre-existing default
    // agent — a broken precondition, reported distinctly), then that it is
    // specifically the incumbent (the determinism contract under test).
    expect(
      [incumbent.metadata!.id, rotatedIn.metadata!.id],
      "getDefault resolved an agent this test did not create — the environment already carries a default agent",
    ).toContain(resolved.metadata?.id);
    expect(resolved.metadata?.id, "the incumbent (lowest id) must win").toBe(incumbent.metadata!.id);

    // getDefault is PLATFORM-global state and the deferred cleanup is
    // best-effort by design — not enough to stand between this test and a
    // leaked platform-wide default. Delete both candidates here and prove the
    // no-default state is restored (also what the negative-path pin and the
    // session suite's no-default case rely on).
    await clients.agentCommand.delete({ value: rotatedIn.metadata!.id });
    await clients.agentCommand.delete({ value: incumbent.metadata!.id });
    await expectGrpcCode(() => clients.agentQuery.getDefault({ org }), Code.NotFound, "getDefault after cleanup");
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
