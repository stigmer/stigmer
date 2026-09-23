// Conformance suite for the Agent -> McpServer cross-aggregate reference
// invariant, and the one reference rule every spec reference is judged by
// at write.
// Domain: agentic / agent — a flat (non-versioned) blueprint resource.
//
// Pins the agent McpServer-reference normalization contract: the accept path
// for an agent referencing an EXISTING McpServer (the reference round-trips on
// the agent and an empty reference org is normalized to the agent's org by
// NormalizeReferences), plus the FailedPrecondition rejection of a reference
// to a non-existent McpServer. Then the rule's three clauses at the wire, in
// both editions: a same-organization target must exist (a skill too, not
// only an MCP server); another organization's target is admitted only at
// platform visibility, and the refusal is ONE sentence whether the target is
// missing or merely not shared, so a create is never an existence probe over
// another organization's rows; and the FLOOR — an agent may not be more
// visible than an MCP server it runs with, at create and when its level is
// raised — because what a person can run they must also be able to read.
//
// WHY this is a separate file: the accept-path test creates/deletes an
// McpServer as a fixture, so the suite requires the McpServer service. It
// was split out of agent.conformance.test.ts during the TS port (sub-project
// decision DD-001, sp.agent-family) so the agent suite could roster before
// McpServer CRUD landed (D4 entry #9); the split stays because the fixture
// dependency it isolates is real either way.
//
// Note: the missing-reference rejection test below does NOT need the
// McpServer fixture (it only calls agentCommand.create), and that rejection
// is also unit-tested in the server (the shared ValidateReferences test in
// src/pipeline/__tests__/steps.test.ts, which pins the FailedPrecondition
// code and copy).
import { Code } from "@connectrpc/connect";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent, makeAgentSpec } from "../support/agents";
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

async function createAgent(
  org: string,
  name: string,
  opts: { description?: string; mcpServerRefs?: string[] } = {},
) {
  const agent = await clients.agentCommand.create(
    makeAgent({ org, name, ...opts }),
  );
  fixtures.defer(() =>
    clients.agentCommand.delete({ value: agent.metadata!.id }),
  );
  return agent;
}

describe("Agent conformance — McpServer references", () => {
  it("accepts an agent referencing an existing McpServer and normalizes the reference org", async () => {
    const { org } = await target.provisionTenancy();
    const mcpServer = await clients.mcpServerCommand.create(
      makeMcpServer({ org, name: uniqueName("tools") }),
    );
    fixtures.defer(() =>
      clients.mcpServerCommand.delete({ resourceId: mcpServer.metadata!.id }),
    );
    const mcpSlug = mcpServer.metadata!.slug;

    const agent = await createAgent(org, uniqueName("agent"), {
      mcpServerRefs: [mcpSlug],
    });

    const usages = agent.spec?.mcpServerUsages ?? [];
    expect(
      usages,
      "the referenced MCP server is preserved on the agent",
    ).toHaveLength(1);
    expect(usages[0]?.mcpServerRef?.slug).toBe(mcpSlug);
    // The request left org empty; NormalizeReferences resolves it to the agent's org.
    expect(
      usages[0]?.mcpServerRef?.org,
      "the empty reference org is normalized to the agent's org",
    ).toBe(org);
  });

  it("rejects an agent referencing a non-existent McpServer (FailedPrecondition)", async () => {
    const { org } = await target.provisionTenancy();
    const missingSlug = "ghost-mcp-server";

    const err = await expectGrpcCode(
      () =>
        clients.agentCommand.create(
          makeAgent({
            org,
            name: uniqueName("agent"),
            mcpServerRefs: [missingSlug],
          }),
        ),
      Code.FailedPrecondition,
      "create agent with missing MCP server reference",
    );
    expect(
      err.message,
      "the error names the missing MCP server slug",
    ).toContain(missingSlug);
  });
});

describe("Agent conformance — the reference rule at write", () => {
  async function createMcpServer(org: string, visibility?: ApiResourceVisibility) {
    const mcpServer = await clients.mcpServerCommand.create(
      makeMcpServer({ org, name: uniqueName("tools") }),
    );
    fixtures.defer(() =>
      clients.mcpServerCommand.delete({ resourceId: mcpServer.metadata!.id }),
    );
    if (visibility !== undefined) {
      await clients.mcpServerCommand.updateVisibility({
        resourceId: mcpServer.metadata!.id,
        visibility,
      });
    }
    return mcpServer;
  }

  /** An agent whose one MCP reference names `slug` in `refOrg` explicitly. */
  function agentReferencing(org: string, refOrg: string, slug: string) {
    const input = makeAgent({ org, name: uniqueName("agent") });
    input.spec = {
      ...makeAgentSpec(),
      mcpServerUsages: [
        { mcpServerRef: { kind: ApiResourceKind.mcp_server, org: refOrg, slug } },
      ],
    };
    return input;
  }

  it("a same-organization skill reference must name an existing skill (FailedPrecondition, the slug named)", async () => {
    const { org } = await target.provisionTenancy();
    const input = makeAgent({ org, name: uniqueName("agent") });
    input.spec = {
      ...makeAgentSpec(),
      skillRefs: [{ kind: ApiResourceKind.skill, slug: "ghost-skill" }],
    };
    const err = await expectGrpcCode(
      () => clients.agentCommand.create(input),
      Code.FailedPrecondition,
      "create agent with a missing skill reference",
    );
    expect(err.message).toContain(
      `referenced skill(s) not found: 'ghost-skill' (org: ${org}).`,
    );
  });

  it("another organization's MCP server is admitted at platform visibility and refused otherwise with one sentence, whether it exists or not", async () => {
    const { org } = await target.provisionTenancy();
    const { org: otherOrg } = await target.provisionTenancy();
    const shared = await createMcpServer(otherOrg, ApiResourceVisibility.visibility_platform);
    const internal = await createMcpServer(otherOrg);

    const admitted = await clients.agentCommand.create(
      agentReferencing(org, otherOrg, shared.metadata!.slug),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: admitted.metadata!.id }));
    expect(admitted.spec?.mcpServerUsages[0]?.mcpServerRef?.org).toBe(otherOrg);

    const sentenceFor = (slug: string) =>
      `referenced MCP server '${otherOrg}/${slug}' is not available to this organization; ` +
      "another organization's resource can be referenced only when that organization shares it at platform visibility.";

    const notShared = await expectGrpcCode(
      () => clients.agentCommand.create(agentReferencing(org, otherOrg, internal.metadata!.slug)),
      Code.FailedPrecondition,
      "create agent referencing another organization's org-visible MCP server",
    );
    expect(notShared.rawMessage).toBe(sentenceFor(internal.metadata!.slug));

    const missing = await expectGrpcCode(
      () => clients.agentCommand.create(agentReferencing(org, otherOrg, "no-such-server")),
      Code.FailedPrecondition,
      "create agent referencing another organization's missing MCP server",
    );
    expect(missing.rawMessage).toBe(sentenceFor("no-such-server"));
  });

  it("the floor at both doors: an org-visible agent may not run a private MCP server, at create and when raised", async () => {
    const { org } = await target.provisionTenancy();
    const mine = await createMcpServer(org, ApiResourceVisibility.visibility_private);
    const slug = mine.metadata!.slug;
    const floorSentence =
      `referenced MCP server '${org}/${slug}' is visibility_private while this resource is visibility_org; ` +
      "a resource may not be more visible than the MCP servers it runs with. " +
      "Widen the referenced resource's visibility or narrow this one.";

    // The spec door: an agent defaults to org visibility, so the create is refused.
    const atCreate = await expectGrpcCode(
      () => clients.agentCommand.create(agentReferencing(org, org, slug)),
      Code.FailedPrecondition,
      "create an org-visible agent over a private MCP server",
    );
    expect(atCreate.rawMessage).toBe(floorSentence);

    // A private agent clears the floor; raising it does not.
    const privateInput = agentReferencing(org, org, slug);
    privateInput.metadata = {
      ...privateInput.metadata,
      visibility: ApiResourceVisibility.visibility_private,
    };
    const created = await clients.agentCommand.create(privateInput);
    fixtures.defer(() => clients.agentCommand.delete({ value: created.metadata!.id }));

    const atEscalation = await expectGrpcCode(
      () =>
        clients.agentCommand.updateVisibility({
          resourceId: created.metadata!.id,
          visibility: ApiResourceVisibility.visibility_org,
        }),
      Code.FailedPrecondition,
      "raise an agent above the MCP server it runs with",
    );
    expect(atEscalation.rawMessage).toBe(floorSentence);
    const stored = await clients.agentQuery.get({ value: created.metadata!.id });
    expect(stored.metadata?.visibility, "the refused escalation leaves the level").toBe(
      ApiResourceVisibility.visibility_private,
    );

    // Widen the dependency and the same escalation passes.
    await clients.mcpServerCommand.updateVisibility({
      resourceId: mine.metadata!.id,
      visibility: ApiResourceVisibility.visibility_org,
    });
    const raised = await clients.agentCommand.updateVisibility({
      resourceId: created.metadata!.id,
      visibility: ApiResourceVisibility.visibility_org,
    });
    expect(raised.metadata?.visibility).toBe(ApiResourceVisibility.visibility_org);
  });
});
