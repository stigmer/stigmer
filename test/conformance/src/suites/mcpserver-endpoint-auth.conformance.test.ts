// McpServer conformance — the save-time completion of a URL-only server.
// Domain: McpServer (endpoint-auth facet).
//
// The contract this facet pins: a server saved with only an `http.url`, by
// any route (create/apply, a plugin push), is asked once at save whether it
// wants OAuth. When the endpoint answers the MCP Authorization challenge
// (401 + WWW-Authenticate: Bearer with an OAuth realm or resource_metadata),
// the server completes the spec with exactly the token variable
// (`<SLUG>_ACCESS_TOKEN`), its secret env declaration, the Bearer header and
// `auth.oauth_only`, and stamps `stigmer.ai/mcp-auth: endpoint` as the
// completion's provenance. It writes nothing else (no discovery_url, no
// scope_hints: Sign in re-reads those from the endpoint), and an endpoint
// that answers anything else leaves the spec exactly as sent. A re-apply of
// the same document reuses the completion with no second probe; a full
// re-send of the completed spec (the console's per-field save) keeps the
// label; an author's own auth is never touched beyond the Bearer header
// that sends its token.
//
// Deliberately out of scope: Sign in itself (mcpserver-oauth), connect
// (mcpserver-connect in the execution class), and the UI that offers the
// button. The fixture is the harness's McpToolFixture with its OAuth lever:
// loopback, so every edition's egress policy that admits its own machine
// reaches it, and the challenge names a metadata URL the completion never
// fetches at save.
import { create } from "@bufbuild/protobuf";
import { McpServerSchema, type McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { McpToolFixture } from "../harness/mcp-server";
import { MCPSERVER_API_VERSION, MCPSERVER_KIND, makeHttpMcpServer } from "../support/mcpservers";
import { uniqueName } from "../support/naming";
import { openPlugin, pluginArchive } from "../support/plugins";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();
const endpoint = new McpToolFixture();

const MCP_AUTH_LABEL = "stigmer.ai/mcp-auth";
const MCP_AUTH_ENDPOINT = "endpoint";
const PLUGIN_LABEL = "stigmer.ai/plugin";

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

async function applyUrlOnly(org: string, name: string) {
  const applied = await clients.mcpServerCommand.apply(makeHttpMcpServer({ org, name, url: endpoint.url() }));
  fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: applied.metadata!.id }));
  return applied;
}

function accessTokenVariable(slug: string): string {
  return `${slug.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_ACCESS_TOKEN`;
}

function headersOf(server: McpServer): Record<string, string> {
  const serverType = server.spec?.serverType;
  return serverType?.case === "http" ? serverType.value.headers : {};
}

describe("McpServer conformance — a URL-only server is completed from its endpoint's challenge", () => {
  it("apply completes exactly the token variable, its declaration, the Bearer header and oauth_only, and stamps the provenance label", async () => {
    challenging();
    const { org } = await target.provisionTenancy();
    const name = uniqueName("urlonly");
    const applied = await applyUrlOnly(org, name);
    const slug = applied.metadata!.slug;
    const variable = accessTokenVariable(slug);

    expect(applied.spec?.auth?.targetEnvVar).toBe(variable);
    expect(applied.spec?.auth?.oauthOnly).toBe(true);
    expect(applied.spec?.auth?.discoveryUrl).toBe("");
    expect(applied.spec?.auth?.scopeHints).toEqual([]);
    expect(applied.spec?.auth?.oauthAppRef).toBeUndefined();
    expect(applied.spec?.env[variable]).toMatchObject({ isSecret: true, optional: false });
    expect(headersOf(applied)).toEqual({ Authorization: `Bearer \${${variable}}` });
    expect(applied.metadata?.labels[MCP_AUTH_LABEL]).toBe(MCP_AUTH_ENDPOINT);

    // One complete initialize reached the endpoint, from a client that names itself.
    const probes = endpoint.capturedRequests();
    expect(probes.map((request) => request.method)).toEqual(["initialize"]);
    expect(probes[0]?.headers["mcp-protocol-version"]).toBe("2025-06-18");

    // What the store holds is what the response said.
    const stored = await clients.mcpServerQuery.get({ value: applied.metadata!.id });
    expect(stored.spec?.auth?.targetEnvVar).toBe(variable);
    expect(stored.metadata?.labels[MCP_AUTH_LABEL]).toBe(MCP_AUTH_ENDPOINT);
  });

  it("re-applying the same document reuses the completion with no second probe and changes nothing", async () => {
    challenging();
    const { org } = await target.provisionTenancy();
    const name = uniqueName("reapply");
    const first = await applyUrlOnly(org, name);
    endpoint.resetCaptured();

    const second = await clients.mcpServerCommand.apply(makeHttpMcpServer({ org, name, url: endpoint.url() }));
    expect(second.metadata?.id).toBe(first.metadata?.id);
    expect(second.spec).toEqual(first.spec);
    expect(second.metadata?.labels[MCP_AUTH_LABEL]).toBe(MCP_AUTH_ENDPOINT);
    expect(endpoint.capturedRequests()).toHaveLength(0);
  });

  it("a full re-send of the completed spec (the console's per-field save) keeps the label and probes nothing", async () => {
    challenging();
    const { org } = await target.provisionTenancy();
    const applied = await applyUrlOnly(org, uniqueName("echo"));
    endpoint.resetCaptured();

    const edited = create(McpServerSchema, applied);
    edited.spec!.description = "edited in the console";
    const updated = await clients.mcpServerCommand.update(edited);
    expect(updated.spec?.description).toBe("edited in the console");
    expect(updated.spec?.auth?.targetEnvVar).toBe(applied.spec?.auth?.targetEnvVar);
    expect(updated.metadata?.labels[MCP_AUTH_LABEL]).toBe(MCP_AUTH_ENDPOINT);
    expect(endpoint.capturedRequests()).toHaveLength(0);
  });

  it("an endpoint that answers without a challenge leaves the spec exactly as sent", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("open");
    const applied = await applyUrlOnly(org, name);
    expect(applied.spec?.auth).toBeUndefined();
    expect(applied.spec?.env).toEqual({});
    expect(headersOf(applied)).toEqual({});
    expect(applied.metadata?.labels[MCP_AUTH_LABEL]).toBeUndefined();
    expect(endpoint.capturedRequests().map((request) => request.method)).toEqual(["initialize"]);
  });

  it("an author's own auth is left alone and never probed; only the Bearer header that sends its token is added", async () => {
    challenging();
    const { org } = await target.provisionTenancy();
    const name = uniqueName("authored");
    // Written inline: the support builder represents the URL-only shape, and
    // an author's own auth block is its deliberate counterpart.
    const applied = await clients.mcpServerCommand.apply({
      apiVersion: MCPSERVER_API_VERSION,
      kind: MCPSERVER_KIND,
      metadata: { name, org },
      spec: {
        description: "an author's own auth",
        serverType: { case: "http", value: { url: endpoint.url() } },
        env: { MY_TOKEN: { isSecret: true } },
        auth: { targetEnvVar: "MY_TOKEN" },
      },
    });
    fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: applied.metadata!.id }));

    expect(applied.spec?.auth?.targetEnvVar).toBe("MY_TOKEN");
    expect(applied.spec?.auth?.oauthOnly).toBe(false);
    expect(headersOf(applied)).toEqual({ Authorization: "Bearer ${MY_TOKEN}" });
    expect(applied.metadata?.labels[MCP_AUTH_LABEL]).toBeUndefined();
    expect(endpoint.capturedRequests()).toHaveLength(0);
  });

  it("a plugin whose mcp.json names the endpoint installs a completed child", async () => {
    challenging();
    const { org } = await target.provisionTenancy();
    const name = uniqueName("plg-urlonly");
    const archive = pluginArchive(
      openPlugin({
        name,
        version: "0.1.0",
        mcpServers: { [name]: { type: "streamable-http", url: endpoint.url() } },
      }),
    );
    const plugin = await clients.pluginCommand.push({ org, artifact: archive });
    fixtures.defer(() =>
      clients.pluginCommand.delete({ value: plugin.metadata!.id }).then(
        () => undefined,
        () => undefined,
      ),
    );

    const child = await clients.mcpServerQuery.getByReference(
      create(ApiResourceReferenceSchema, { org, kind: ApiResourceKind.mcp_server, slug: name }),
    );
    expect(child.metadata?.labels[PLUGIN_LABEL]).toBe(plugin.metadata?.id);
    expect(child.metadata?.labels[MCP_AUTH_LABEL]).toBe(MCP_AUTH_ENDPOINT);
    expect(child.spec?.auth?.targetEnvVar).toBe(accessTokenVariable(child.metadata!.slug));
    expect(child.spec?.auth?.oauthOnly).toBe(true);
    expect(headersOf(child)).toEqual({ Authorization: `Bearer \${${accessTokenVariable(child.metadata!.slug)}}` });
  });
});
