// Conformance suite for the platform-filled STIGMER_SERVER_ADDRESS (Class B).
// Domain: agentic / agentexecution: environment → instance → execution →
// the runner's fill → a remote MCP server's templated header.
//
// The contract under test (stigmer/stigmer#1446, #1451, #1458): a value the
// user SAVED for STIGMER_SERVER_ADDRESS is the value their MCP server
// receives, and when nothing is saved the runner fills the key from the public
// endpoint its launcher gave it, so the server still receives an address. The
// platform fills the key only when it is missing (the runner's
// platform-server-address module), below every saved value, so a saved one
// is never replaced by the platform's own address. The chain crosses four
// components (environment resolution, the least-privilege filter, the
// runner's fill, header templating) and the observation point is the
// receiving server itself, exactly as mcp-caller-identity observes its keys:
// the McpToolFixture records the headers of the `tools/call` that dispatched
// the tool.
//
// The harness runner is given a public endpoint (test/support/src/runner-process.ts),
// so the fill is live for this remote server and a saved value that lost to
// it would show as the harness server's own address. Every edition's runner
// here is launched by that one harness, which hands the endpoint back
// (TargetProfile.runnerPublicEndpoint), so the unsaved arm asserts the fill
// from the endpoint the runner was given, as the gRPC target `host:port` the
// fill writes. The harness gives the runner one value for both its public and
// its backend endpoint, so the arm proves the fill reaches the server end to
// end, not which of the two it read: that a remote server is filled from the
// public endpoint alone is pinned beside the code
// (runner shared/__tests__/platform-server-address.test.ts). Deliberately
// out of scope: WHICH endpoint each production launcher passes (`stigmer up`,
// the chart, the desktop), pinned per launcher beside its code. An unresolved `${STIGMER_SERVER_ADDRESS}` makes the runner
// skip the server, so a fixture that receives the call has already shown no
// placeholder failed.
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { McpToolFixture } from "../harness/mcp-server";
import { ECHO_TOOL_NAME } from "../harness/mcp-server";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
import { makeAgent } from "../support/agents";
import { awaitTerminal, makeAgentExecution, requireLlmProxy, requireMcpFixture } from "../support/agentexecutions";
import { makeAgentInstance } from "../support/agentinstances";
import { makeEnvironment } from "../support/environments";
import { makeHttpMcpServer } from "../support/mcpservers";
import { uniqueName } from "../support/naming";
import { makeSession } from "../support/sessions";
import { createTarget, type TargetProfile } from "../targets";

// The reserved key, pinned verbatim to the runner's platform-server-address.ts.
const SERVER_ADDRESS_ENV_KEY = "STIGMER_SERVER_ADDRESS";

// The header the suite templates the key into; Node lowercases incoming names.
const ADDRESS_HEADER = "x-stigmer-server-address";

// The address a fill from `endpoint` delivers, the runner's grpcTarget rule
// (platform-server-address.ts) stated as the promise: an http(s) URL becomes
// its host with an explicit port, the scheme's default when the URL names
// none; anything else is already a dial target and arrives unchanged.
function filledAddressFrom(endpoint: string): string {
  if (!/^https?:\/\//i.test(endpoint)) return endpoint;
  const url = new URL(endpoint);
  const port = url.port !== "" ? url.port : url.protocol === "https:" ? "443" : "80";
  return `${url.hostname}:${port}`;
}

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
let mcp: McpToolFixture;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
  mcp = requireMcpFixture(target);
});

afterEach(async () => {
  await fixtures.cleanup();
  mock.reset();
  mcp.resetCaptured();
});

afterAll(async () => {
  await target?.teardown();
});

describe("platform STIGMER_SERVER_ADDRESS (environment → instance → execution → headers)", () => {
  it("delivers the address the user saved, never the platform's own", async () => {
    const { org } = await target.provisionTenancy();
    const saved = "saved.example.com:7234";

    const environment = await clients.environmentCommand.create(
      makeEnvironment({
        org,
        name: uniqueName("env-address"),
        data: { [SERVER_ADDRESS_ENV_KEY]: { value: saved } },
      }),
    );
    fixtures.defer(() => clients.environmentCommand.delete({ resourceId: environment.metadata!.id }));

    const server = await clients.mcpServerCommand.create(
      makeHttpMcpServer({
        org,
        name: uniqueName("mcp-address"),
        url: mcp.url(),
        headers: { "X-Stigmer-Server-Address": `\${${SERVER_ADDRESS_ENV_KEY}}` },
        env: { [SERVER_ADDRESS_ENV_KEY]: { optional: true, description: "Filled by the platform when not saved" } },
      }),
    );
    fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));

    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("agent-address"), mcpServerRefs: [server.metadata!.slug] }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

    const instance = await clients.agentInstanceCommand.create(
      makeAgentInstance({
        org,
        name: uniqueName("ain-address"),
        agentId: agent.metadata!.id,
        environmentRefs: [{ org, slug: environment.metadata!.slug }],
      }),
    );
    fixtures.defer(() => clients.agentInstanceCommand.delete({ value: instance.metadata!.id }));

    const session = await clients.sessionCommand.create(
      makeSession({ org, name: uniqueName("session-address"), agentInstanceId: instance.metadata!.id }),
    );
    fixtures.defer(() => clients.sessionCommand.delete({ value: session.metadata!.id }));

    mock.enqueue(anthropicToolUse("call_echo_address", ECHO_TOOL_NAME, { text: "ping" }));
    mock.enqueue(anthropicText("Done."));

    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("aex-address"),
        sessionId: session.metadata!.id,
        autoApproveAll: true,
      }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    const final = await awaitTerminal(clients, executionId);
    expect(
      final.status?.phase,
      `execution ${executionId} should complete; reached ${ExecutionPhase[final.status?.phase ?? 0]}`,
    ).toBe(ExecutionPhase.EXECUTION_COMPLETED);

    const toolCalls = mcp.capturedRequests().filter((r) => r.method === "tools/call");
    expect(toolCalls.length, "the echo dispatch reaches the fixture as a tools/call").toBeGreaterThan(0);
    for (const call of toolCalls) {
      expect(call.headers[ADDRESS_HEADER], "the saved address reaches the server unchanged").toBe(saved);
    }
  });

  it("fills the address from the endpoint the runner was launched with when nothing is saved", async () => {
    if (target.runnerPublicEndpoint === undefined) {
      throw new Error(`target ${target.name} spawns no runner; the fill arm needs the endpoint it was given`);
    }
    const expected = filledAddressFrom(target.runnerPublicEndpoint());
    const { org } = await target.provisionTenancy();

    const server = await clients.mcpServerCommand.create(
      makeHttpMcpServer({
        org,
        name: uniqueName("mcp-address-fill"),
        url: mcp.url(),
        headers: { "X-Stigmer-Server-Address": `\${${SERVER_ADDRESS_ENV_KEY}}` },
        env: { [SERVER_ADDRESS_ENV_KEY]: { optional: true, description: "Filled by the platform when not saved" } },
      }),
    );
    fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));

    // No environment anywhere on the chain: the agent runs straight, so nothing
    // is saved for the key and the fill is the only source of its value.
    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("agent-address-fill"), mcpServerRefs: [server.metadata!.slug] }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

    mock.enqueue(anthropicToolUse("call_echo_address_fill", ECHO_TOOL_NAME, { text: "ping" }));
    mock.enqueue(anthropicText("Done."));

    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("aex-address-fill"),
        agentId: agent.metadata!.id,
        autoApproveAll: true,
      }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    const final = await awaitTerminal(clients, executionId);
    expect(
      final.status?.phase,
      `execution ${executionId} should complete; reached ${ExecutionPhase[final.status?.phase ?? 0]}`,
    ).toBe(ExecutionPhase.EXECUTION_COMPLETED);

    const toolCalls = mcp.capturedRequests().filter((r) => r.method === "tools/call");
    expect(
      toolCalls.length,
      `execution ${executionId}: the echo dispatch reaches the fixture, so the placeholder resolved`,
    ).toBeGreaterThan(0);
    for (const call of toolCalls) {
      expect(call.headers[ADDRESS_HEADER], `execution ${executionId}: the runner fills the endpoint it was launched with`).toBe(
        expected,
      );
    }
  });
});
