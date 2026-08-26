// Conformance suite for the Agent -> McpServer cross-aggregate reference
// invariant.
// Domain: agentic / agent — a flat (non-versioned) blueprint resource.
//
// Pins the agent McpServer-reference normalization contract: the accept path
// for an agent referencing an EXISTING McpServer (the reference round-trips on
// the agent and an empty reference org is normalized to the agent's org by
// NormalizeReferences), plus the FailedPrecondition rejection of a reference
// to a non-existent McpServer.
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
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
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
