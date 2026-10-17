// An agent's own MCP servers (AgentSpec.mcp_servers): written in the agent,
// by name and address, in one call, and only by an organization's admins.
// A server is where every run of the agent dials with its login and its
// values, so adding one, or changing where it points or what it sends, is
// the same act as installing a plugin that carries it: `can_create_plugin`
// on the organization. The write is judged by content, as the reserved
// labels are: a member's whole-agent apply that echoes the stored servers
// passes, so does one that removes them; a new server or a changed address
// or header is PERMISSION_DENIED with the copy that says to ask an admin.
//
// Two lanes:
//   - the authority arms run on the ENFORCING lane (targets/target.ts), with
//     a real admin and a real member of one organization; a target with no
//     enforcing lane skips them visibly;
//   - the shape arms run on the primary, on every target: a server named
//     twice, a reserved name, an address that is not https (or http on
//     this machine), a name or header outside the grammar, all
//     INVALID_ARGUMENT.
//
// What a run plans for a server (its values, its login at its address, the
// version it is read at) is pinned by the server's run-values suite
// (backend/services/stigmer-server/src/domain/vault/__tests__/resolve.test.ts);
// what a run does with it, by the execution suites once the runner starts
// an agent's own servers.
import { clone, create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentMcpServerSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
import type { AgentOptions } from "../support/agents";
import { uniqueName } from "../support/naming";
import { createTarget, enforcingLaneOf, type EnforcingLane, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
let enforcing: Awaited<ReturnType<typeof enforcingLaneOf>>;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  enforcing = await enforcingLaneOf(target);
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

function laneOrSkip(ctx: { skip: (note?: string) => never }): EnforcingLane {
  if (enforcing.lane === undefined) ctx.skip(enforcing.reason);
  return enforcing.lane;
}

const ZENDESK = { name: "zendesk", url: "https://acme-co.zendesk.com/mcp", headers: { "X-Api-Key": "${ZENDESK_KEY}" } };

function adminOnly(names: string): string {
  return (
    `only an organization's admins may add or change an agent's MCP servers (${names}); ` +
    "ask an admin, or use a plugin an admin installed"
  );
}

interface Cast {
  readonly org: string;
  readonly owner: ConformanceClients;
  readonly admin: ConformanceClients;
  readonly member: ConformanceClients;
}

async function castOf(lane: EnforcingLane): Promise<Cast> {
  const tenancy = await lane.provisionTenancy();
  fixtures.defer(() => lane.cleanupTenancy(tenancy));
  return {
    org: tenancy.org,
    owner: lane.clients,
    admin: await lane.provisionWithRole(tenancy, "admin"),
    member: await lane.provisionMember(tenancy),
  };
}

/** Creates `opts` as `writer`, deleted by `owner` after the test. */
async function created(writer: ConformanceClients, owner: ConformanceClients, opts: AgentOptions) {
  const agent = await writer.agentCommand.create(makeAgent(opts));
  fixtures.defer(() => owner.agentCommand.delete({ value: agent.metadata!.id }));
  return agent;
}

describe("an agent's own MCP servers: who may write them", () => {
  it("[rpc:AgentCommandController.create] an admin creates an agent with its own server in one call", async (ctx) => {
    const c = await castOf(laneOrSkip(ctx));
    const agent = await created(c.admin, c.owner, { org: c.org, name: uniqueName("mcp-agent"), mcpServers: [ZENDESK] });
    expect(agent.spec?.mcpServers.map((server) => [server.name, server.url, { ...server.headers }])).toEqual([
      [ZENDESK.name, ZENDESK.url, ZENDESK.headers],
    ]);
    const read = await c.member.agentQuery.get({ value: agent.metadata!.id });
    expect(read.spec?.mcpServers.map((server) => server.name)).toEqual([ZENDESK.name]);
  });

  it("[rpc:AgentCommandController.create] a member's create with a server is refused, naming the server and the way out", async (ctx) => {
    const c = await castOf(laneOrSkip(ctx));
    const error = await expectGrpcCode(
      () => c.member.agentCommand.create(makeAgent({ org: c.org, name: uniqueName("mcp-agent"), mcpServers: [ZENDESK] })),
      Code.PermissionDenied,
      "member create with a server",
    );
    expect(error.rawMessage).toBe(adminOnly("zendesk"));
    // The same member creates the agent without the server.
    await created(c.member, c.owner, { org: c.org, name: uniqueName("mcp-agent") });
  });

  it("[rpc:AgentCommandController.apply] a member's apply that echoes the stored servers passes, and one that removes them passes", async (ctx) => {
    const c = await castOf(laneOrSkip(ctx));
    const name = uniqueName("mcp-agent");
    await created(c.member, c.owner, { org: c.org, name });
    // An admin adds the server to the member's agent.
    await c.admin.agentCommand.apply(makeAgent({ org: c.org, name, mcpServers: [ZENDESK] }));
    const echoed = await c.member.agentCommand.apply(
      makeAgent({ org: c.org, name, description: "edited by a member", mcpServers: [{ ...ZENDESK, headers: { ...ZENDESK.headers } }] }),
    );
    expect(echoed.spec?.description).toBe("edited by a member");
    expect(echoed.spec?.mcpServers.map((server) => server.url)).toEqual([ZENDESK.url]);
    const removed = await c.member.agentCommand.apply(makeAgent({ org: c.org, name }));
    expect(removed.spec?.mcpServers).toEqual([]);
  });

  it("[rpc:AgentCommandController.apply] a member's apply that moves a server or changes its headers is refused", async (ctx) => {
    const c = await castOf(laneOrSkip(ctx));
    const name = uniqueName("mcp-agent");
    const agent = await created(c.member, c.owner, { org: c.org, name });
    await c.admin.agentCommand.apply(makeAgent({ org: c.org, name, mcpServers: [ZENDESK] }));
    const moved = await expectGrpcCode(
      () => c.member.agentCommand.apply(makeAgent({ org: c.org, name, mcpServers: [{ ...ZENDESK, url: "https://elsewhere.example.com/mcp" }] })),
      Code.PermissionDenied,
      "member moves the server",
    );
    expect(moved.rawMessage).toBe(adminOnly("zendesk"));
    await expectGrpcCode(
      () => c.member.agentCommand.apply(makeAgent({ org: c.org, name, mcpServers: [{ ...ZENDESK, headers: { "X-Api-Key": "${OTHER}" } }] })),
      Code.PermissionDenied,
      "member changes the server's header",
    );
    const read = await c.owner.agentQuery.get({ value: agent.metadata!.id });
    expect(read.spec?.mcpServers.map((server) => [server.url, { ...server.headers }])).toEqual([[ZENDESK.url, ZENDESK.headers]]);
  });

  it("[rpc:AgentCommandController.update] a member's update adding a server is refused; an admin's is not", async (ctx) => {
    const c = await castOf(laneOrSkip(ctx));
    const agent = await created(c.member, c.owner, { org: c.org, name: uniqueName("mcp-agent") });
    const withServer = clone(AgentSchema, agent);
    withServer.spec!.mcpServers = [create(AgentMcpServerSchema, ZENDESK)];
    await expectGrpcCode(
      () => c.member.agentCommand.update({ resource: withServer, updateMask: { paths: ["spec.mcp_servers"] } }),
      Code.PermissionDenied,
      "member update adding a server",
    );
    const updated = await c.admin.agentCommand.update({ resource: withServer, updateMask: { paths: ["spec.mcp_servers"] } });
    expect(updated.spec?.mcpServers.map((server) => server.name)).toEqual([ZENDESK.name]);
  });
});

describe("an agent's own MCP servers: what a server may be", () => {
  it.each([
    ["a name used twice", [ZENDESK, { ...ZENDESK, url: "https://other.example.com/mcp" }], "is listed more than once"],
    ["a platform server's name", [{ ...ZENDESK, name: "stigmer-memory" }], "takes a reserved name"],
    ["a name starting stigmer", [{ ...ZENDESK, name: "stigmer-crm" }], "takes a reserved name"],
    ["the name plugin", [{ ...ZENDESK, name: "plugin" }], "takes a reserved name"],
    ["an http address off this machine", [{ ...ZENDESK, url: "http://acme-co.zendesk.com/mcp" }], "has an address that is not https"],
    ["a variable in the address", [{ ...ZENDESK, url: "https://${TENANT}.zendesk.com/mcp" }], "names a variable in its url"],
    ["a header named twice", [{ ...ZENDESK, headers: { "X-Key": "a", "x-key": "b" } }], "more than once"],
    ["a plugin's user_config in a header", [{ ...ZENDESK, headers: { Authorization: "Bearer ${user_config.token}" } }], "is not a run value"],
  ])("[rpc:AgentCommandController.create] refuses %s", async (_label, mcpServers, copy) => {
    const { org } = await target.provisionTenancy();
    const error = await expectGrpcCode(
      () => clients.agentCommand.create(makeAgent({ org, name: uniqueName("mcp-agent"), mcpServers })),
      Code.InvalidArgument,
      "create with a malformed server",
    );
    expect(error.rawMessage).toContain(copy);
  });

  it.each([
    ["a name outside the grammar", { ...ZENDESK, name: "Zendesk_CRM" }],
    ["a header name that is no HTTP token", { ...ZENDESK, headers: { "X Key": "a" } }],
    ["an empty address", { ...ZENDESK, url: "" }],
  ])("[rpc:AgentCommandController.create] refuses %s by the contract's own rules", async (_label, server) => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.agentCommand.create(makeAgent({ org, name: uniqueName("mcp-agent"), mcpServers: [server] })),
      Code.InvalidArgument,
      "create with a server the proto refuses",
    );
  });

  it("[rpc:AgentCommandController.create] refuses more than 20 servers", async () => {
    const { org } = await target.provisionTenancy();
    const mcpServers = Array.from({ length: 21 }, (_, index) => ({ name: `s${index}x`, url: `https://s${index}.example.com/mcp` }));
    await expectGrpcCode(
      () => clients.agentCommand.create(makeAgent({ org, name: uniqueName("mcp-agent"), mcpServers })),
      Code.InvalidArgument,
      "create with 21 servers",
    );
  });
});
