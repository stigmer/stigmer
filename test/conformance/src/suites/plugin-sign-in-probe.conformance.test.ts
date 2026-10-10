// Plugin conformance — the install-time sign-in probe of a URL-only server.
// Domain: agentic / plugin (sign-in-probe facet).
//
// The contract this facet pins: a plugin's MCP server at an address that
// says nothing about authentication (no variables, no Authorization header,
// no `${VAR}` in any header) is asked once, at install, whether it wants a
// sign-in. When the endpoint answers the MCP Authorization challenge (401 +
// WWW-Authenticate: Bearer with an OAuth realm or resource_metadata), the
// plugin's stored entry is completed with exactly what makes Sign in work:
// `sign_in.oauth_only`, the token variable `<SERVER>_ACCESS_TOKEN` (the
// server's name, upper-cased) in the entry's `env`, its declaration as a
// required secret in the plugin's `env`, and the
// `Authorization: Bearer ${<SERVER>_ACCESS_TOKEN}` header. Nothing else is
// written, and the archive is never rewritten. An endpoint that answers
// anything else leaves the entry exactly as read; an author who speaks about
// authentication is never asked; a re-push of the installed archive (the
// same digest), at any level, reuses the stored entries and asks nothing.
//
// Deliberately out of scope: signing in itself (plugin-oauth), listing the
// server's tools (suites-execution/plugin-tools), and the UI that offers
// the button. The endpoint is the harness's McpToolFixture with its OAuth
// lever: loopback, so every edition's egress policy that admits its own
// machine reaches it, and the challenge names a metadata URL the probe
// never fetches.
import type { McpServerEntry } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { McpToolFixture } from "../harness/mcp-server";
import { uniqueName } from "../support/naming";
import { type PluginFixture, oneServerPlugin, pluginArchive, pushPlugin } from "../support/plugins";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();
const endpoint = new McpToolFixture();

// The server's name inside every plugin here, and the variable a completed
// entry reads.
const SERVER = "linear";
const ACCESS_TOKEN = "LINEAR_ACCESS_TOKEN";

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

function urlOnly(name: string): PluginFixture {
  return oneServerPlugin({ name, serverName: SERVER, server: { url: endpoint.url() } });
}

function headersOf(entry: McpServerEntry | undefined): Record<string, string> {
  return entry?.transport.case === "http" ? entry.transport.value.headers : {};
}

describe("[rpc:PluginCommandController.push] Plugin conformance — a URL-only server is completed from its endpoint's challenge", () => {
  it("install completes exactly oauth_only, the token variable and its declaration, and the Bearer header", async () => {
    challenging();
    const { org } = await target.provisionTenancy();
    const plugin = await pushPlugin(clients, fixtures, org, urlOnly(uniqueName("plg-urlonly")));

    const entry = plugin.status?.mcpServers[0];
    expect(plugin.status?.mcpServers.map((s) => s.name)).toEqual([SERVER]);
    expect(entry?.signIn?.oauthOnly).toBe(true);
    expect(entry?.env).toEqual([ACCESS_TOKEN]);
    expect(headersOf(entry)).toEqual({ Authorization: `Bearer \${${ACCESS_TOKEN}}` });
    expect(entry?.transport.case === "http" ? entry.transport.value.url : "").toBe(endpoint.url());
    expect(Object.keys(plugin.status?.env ?? {})).toEqual([ACCESS_TOKEN]);
    expect(plugin.status?.env[ACCESS_TOKEN]).toMatchObject({ isSecret: true, optional: false });

    // One complete initialize reached the endpoint, from a client that names itself.
    const probes = endpoint.capturedRequests();
    expect(probes.map((request) => request.method)).toEqual(["initialize"]);
    expect(probes[0]?.headers["mcp-protocol-version"]).toBe("2025-06-18");

    // What the store holds is what the response said.
    const stored = await clients.pluginQuery.get({ value: plugin.metadata!.id });
    expect(stored.status?.mcpServers).toEqual(plugin.status?.mcpServers);
    expect(stored.status?.env).toEqual(plugin.status?.env);
  });

  it("re-pushing the installed archive, at the same level or another, reuses the completion and probes nothing", async () => {
    challenging();
    const { org } = await target.provisionTenancy();
    const archive = pluginArchive(urlOnly(uniqueName("plg-repush")));
    const first = await pushPlugin(clients, fixtures, org, archive);
    endpoint.resetCaptured();

    const again = await clients.pluginCommand.push({ org, artifact: archive });
    expect(again.metadata?.id).toBe(first.metadata?.id);
    expect(again.status?.mcpServers).toEqual(first.status?.mcpServers);

    const moved = await clients.pluginCommand.push({
      org,
      artifact: archive,
      visibility: ApiResourceVisibility.visibility_private,
    });
    expect(moved.metadata?.visibility).toBe(ApiResourceVisibility.visibility_private);
    expect(moved.status?.mcpServers[0]?.signIn?.oauthOnly).toBe(true);
    expect(moved.status?.env).toEqual(first.status?.env);
    expect(endpoint.capturedRequests()).toHaveLength(0);
  });

  it("an endpoint that answers without a challenge leaves the entry exactly as read", async () => {
    const { org } = await target.provisionTenancy();
    const plugin = await pushPlugin(clients, fixtures, org, urlOnly(uniqueName("plg-open")));
    const entry = plugin.status?.mcpServers[0];
    expect(entry?.signIn).toBeUndefined();
    expect(entry?.env).toEqual([]);
    expect(headersOf(entry)).toEqual({});
    expect(plugin.status?.env).toEqual({});
    expect(endpoint.capturedRequests().map((request) => request.method)).toEqual(["initialize"]);
  });

  it("an author's own Authorization header and variable are left alone and never probed", async () => {
    challenging();
    const { org } = await target.provisionTenancy();
    const plugin = await pushPlugin(
      clients,
      fixtures,
      org,
      oneServerPlugin({
        name: uniqueName("plg-authored"),
        serverName: SERVER,
        server: { url: endpoint.url(), headers: { Authorization: "Bearer ${MY_TOKEN}" } },
      }),
    );
    const entry = plugin.status?.mcpServers[0];
    expect(entry?.signIn).toBeUndefined();
    expect(entry?.env).toEqual(["MY_TOKEN"]);
    expect(headersOf(entry)).toEqual({ Authorization: "Bearer ${MY_TOKEN}" });
    expect(Object.keys(plugin.status?.env ?? {})).toEqual(["MY_TOKEN"]);
    expect(endpoint.capturedRequests()).toHaveLength(0);
  });
});
