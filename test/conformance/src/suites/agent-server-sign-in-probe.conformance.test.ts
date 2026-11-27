// Agent conformance — the save-time sign-in probe of an agent's own MCP server.
// Domain: agentic / agent (server sign-in facet).
//
// The contract this facet pins: an MCP server an agent writes itself, at an
// address that says nothing about authentication (no Authorization header,
// no `${VAR}` in a header), is asked at the agent's save whether it wants a
// sign-in, with the same one `initialize` a plugin's install sends. The
// answer is kept on the agent's status (`server_sign_ins`), with the address
// it was asked at: a sign-in (`oauth_only`) when the endpoint answered the
// MCP Authorization challenge, none for any other answer. A save that keeps
// the server unchanged asks nothing and carries the answer; a save that
// moves the server asks again. An author who speaks about authentication is
// never asked. The answer lives in status: it never moves the version hash.
//
// Deliberately out of scope: what a run does with the answer (the server's
// resolver tests), signing in itself (vault-sign-in), and the chat's button.
// The endpoint is the harness's McpToolFixture with its OAuth lever:
// loopback, so every edition's egress policy that admits its own machine
// reaches it.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { McpToolFixture } from "../harness/mcp-server";
import { makeAgent } from "../support/agents";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();
const endpoint = new McpToolFixture();

// The server's name inside every agent here.
const SERVER = "app-tools";

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  await endpoint.start();
});

afterEach(async () => {
  endpoint.requireOAuth(undefined);
  endpoint.resetCaptured();
  await fixtures.cleanup();
});

afterAll(async () => {
  await endpoint.close();
  await target?.teardown();
});

function challenging(): void {
  endpoint.requireOAuth({ resourceMetadataUrl: `${endpoint.url()}/.well-known/oauth-protected-resource` });
}

async function applyAgent(org: string, name: string, server: { url: string; headers?: Record<string, string> }) {
  const agent = await clients.agentCommand.apply(
    makeAgent({ org, name, mcpServers: [{ name: SERVER, url: server.url, headers: server.headers ?? {} }] }),
  );
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return agent;
}

describe("[rpc:AgentCommandController.apply] Agent conformance — an agent's own server is asked whether it wants a sign-in", () => {
  it("records a sign-in, at the address it asked, for a server that answers with the OAuth challenge", async () => {
    challenging();
    const { org } = await target.provisionTenancy();
    const agent = await applyAgent(org, uniqueName("agt-signs-in"), { url: endpoint.url() });

    expect(agent.status?.serverSignIns.map((answer) => [answer.name, answer.url, answer.signIn?.oauthOnly])).toEqual([
      [SERVER, endpoint.url(), true],
    ]);
    expect(endpoint.capturedRequests().map((request) => request.method)).toEqual(["initialize"]);
    // The spec is the author's: nothing is written into it.
    expect(agent.spec?.mcpServers[0]?.headers).toEqual({});

    const stored = await clients.agentQuery.get({ value: agent.metadata!.id });
    expect(stored.status?.serverSignIns).toEqual(agent.status?.serverSignIns);
  });

  it("carries the answer through a save that keeps the server, asking nothing and moving no version", async () => {
    challenging();
    const { org } = await target.provisionTenancy();
    const name = uniqueName("agt-carried");
    const first = await applyAgent(org, name, { url: endpoint.url() });
    endpoint.resetCaptured();

    const again = await clients.agentCommand.apply(
      makeAgent({ org, name, mcpServers: [{ name: SERVER, url: endpoint.url(), headers: {} }] }),
    );
    expect(again.status?.serverSignIns).toEqual(first.status?.serverSignIns);
    expect(again.status?.versionHash).toBe(first.status?.versionHash);
    expect(endpoint.capturedRequests()).toHaveLength(0);
  });

  it("records no sign-in for a server that answers without a challenge", async () => {
    const { org } = await target.provisionTenancy();
    const agent = await applyAgent(org, uniqueName("agt-open"), { url: endpoint.url() });
    expect(agent.status?.serverSignIns.map((answer) => [answer.name, answer.url, answer.signIn])).toEqual([
      [SERVER, endpoint.url(), undefined],
    ]);
  });

  it("never asks a server whose author speaks about authentication", async () => {
    challenging();
    const { org } = await target.provisionTenancy();
    const agent = await applyAgent(org, uniqueName("agt-authored"), {
      url: endpoint.url(),
      headers: { Authorization: "Bearer ${APP_TOOLS_KEY}" },
    });
    expect(agent.status?.serverSignIns).toEqual([]);
    expect(endpoint.capturedRequests()).toHaveLength(0);
  });
});
