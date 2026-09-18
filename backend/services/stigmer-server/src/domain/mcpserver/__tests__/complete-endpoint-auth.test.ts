/**
 * Pins CompleteEndpointAuth over a fake fetch: the author's shape and
 * nothing else is probed; an OAuth challenge completes exactly the trio
 * plus the provenance label and the completed spec passes the proto
 * validator; every other outcome and a throwing fetch leave the spec as
 * sent; carry-over reuses an earlier completion with no network; the
 * console's exact echo keeps the label; the author's own auth drops it; a
 * changed URL probes again; the Bearer default serves a hand-written auth;
 * the label is recorded as stamped so GuardReservedLabels admits it.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import type { OutboundFetch } from "@stigmer/outbound/egress";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerAuthSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { MCP_AUTH_ENDPOINT, MCP_AUTH_LABEL } from "../../../pipeline/apiresource-labels.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { serverStampedReservedLabels } from "../../../pipeline/steps/server-stamped-reserved-labels.js";
import { validator } from "../../../pipeline/steps/validation.js";
import { accessTokenVariable, newCompleteEndpointAuthStep } from "../complete-endpoint-auth.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const URL_ONLY = "https://mcp.vendor.test/mcp";
const CHALLENGE = 'Bearer realm="OAuth", resource_metadata="https://mcp.vendor.test/.well-known/oauth-protected-resource/mcp"';
const VARIABLE = "LINEAR_ACCESS_TOKEN";

interface FakeFetch {
  readonly fetchImpl: OutboundFetch;
  readonly calls: { url: string; init: RequestInit | undefined }[];
}

function answering(status: number, headers: Record<string, string> = {}): FakeFetch {
  const calls: FakeFetch["calls"] = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(null, { status, headers });
    },
  };
}

function throwing(): FakeFetch {
  const calls: FakeFetch["calls"] = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      throw new Error("connect ECONNREFUSED");
    },
  };
}

function server(overrides: { url?: string; headers?: Record<string, string>; env?: Record<string, { isSecret: boolean; optional?: boolean; description?: string }>; auth?: { targetEnvVar?: string; oauthOnly?: boolean; discoveryUrl?: string }; labels?: Record<string, string>; stdio?: boolean } = {}): McpServer {
  return create(McpServerSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "McpServer",
    metadata: { id: "mcps_1", name: "Linear", slug: "linear", org: "acme", labels: overrides.labels ?? {} },
    spec: {
      description: "Linear's hosted MCP server",
      serverType: overrides.stdio === true ? { case: "stdio", value: { command: "npx" } } : { case: "http", value: { url: overrides.url ?? URL_ONLY, headers: overrides.headers ?? {} } },
      env: Object.fromEntries(Object.entries(overrides.env ?? {}).map(([k, v]) => [k, create(EnvVarDeclarationSchema, { isSecret: v.isSecret, optional: v.optional ?? false, description: v.description ?? "" })])),
      ...(overrides.auth !== undefined ? { auth: create(McpServerAuthSchema, overrides.auth) } : {}),
    },
  });
}

/** A row as an earlier save completed it: the trio and the label. */
function completedRow(url = URL_ONLY): McpServer {
  return server({
    url,
    headers: { Authorization: `Bearer \${${VARIABLE}}` },
    env: { [VARIABLE]: { isSecret: true, description: "OAuth access token for the 'linear' MCP server; Sign in fills it" } },
    auth: { targetEnvVar: VARIABLE, oauthOnly: true },
    labels: { [MCP_AUTH_LABEL]: MCP_AUTH_ENDPOINT },
  });
}

async function run(incoming: McpServer, fake: FakeFetch, existing?: McpServer): Promise<RequestContext<typeof McpServerSchema>> {
  const ctx = new RequestContext(McpServerSchema, incoming, testCallerIdentity(), ApiResourceKind.mcp_server);
  if (existing !== undefined) ctx.set(EXISTING_RESOURCE_KEY, existing);
  await newCompleteEndpointAuthStep({ outboundFetch: fake.fetchImpl, logger: silentLogger }).execute(ctx);
  return ctx;
}

function expectCompleted(state: McpServer): void {
  expect(state.spec?.auth?.targetEnvVar).toBe(VARIABLE);
  expect(state.spec?.auth?.oauthOnly).toBe(true);
  expect(state.spec?.auth?.discoveryUrl).toBe("");
  expect(state.spec?.auth?.scopeHints).toEqual([]);
  expect(state.spec?.env[VARIABLE]).toMatchObject({ isSecret: true, optional: false });
  expect(state.spec?.env[VARIABLE]?.description).toContain("Sign in fills it");
  expect(state.spec?.serverType.case === "http" ? state.spec.serverType.value.headers : {}).toEqual({ Authorization: `Bearer \${${VARIABLE}}` });
  expect(state.metadata?.labels[MCP_AUTH_LABEL]).toBe(MCP_AUTH_ENDPOINT);
}

function expectUntouched(state: McpServer, incoming: McpServer): void {
  expect(state.spec).toEqual(incoming.spec);
  expect(state.metadata?.labels[MCP_AUTH_LABEL]).toBeUndefined();
}

describe("CompleteEndpointAuth: the author's shape is probed with one complete initialize", () => {
  it("completes exactly the trio plus the label on an OAuth challenge, and the completed spec validates", async () => {
    const fake = answering(401, { "www-authenticate": CHALLENGE });
    const ctx = await run(server(), fake);
    expectCompleted(ctx.newState);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.url).toBe(URL_ONLY);
    const body = JSON.parse(String(fake.calls[0]?.init?.body)) as { method: string; params: { protocolVersion: string; clientInfo: { name: string } } };
    expect(body.method).toBe("initialize");
    expect(body.params.protocolVersion).toBe("2025-06-18");
    expect(body.params.clientInfo.name).toBe("stigmer-server");
    expect(serverStampedReservedLabels(ctx).has(MCP_AUTH_LABEL)).toBe(true);
    expect(validator().validate(McpServerSchema, ctx.newState).kind).toBe("valid");
  });

  it("sends the author's literal headers with the probe", async () => {
    const fake = answering(200);
    await run(server({ headers: { "X-Vendor-Region": "eu" } }), fake);
    expect((fake.calls[0]?.init?.headers as Record<string, string>)["X-Vendor-Region"]).toBe("eu");
  });

  it.each([
    ["a 2xx (an open endpoint)", answering(200)],
    ["a non-OAuth 401 (a static-token API)", answering(401, { "www-authenticate": 'Bearer error="invalid_token"' })],
    ["a 401 without a challenge header", answering(401)],
    ["any other status", answering(405)],
    ["no answer at all", throwing()],
  ])("leaves the spec as sent on %s", async (_label, fake) => {
    const incoming = server();
    const ctx = await run(incoming, fake);
    expectUntouched(ctx.newState, incoming);
    expect(serverStampedReservedLabels(ctx).has(MCP_AUTH_LABEL)).toBe(false);
  });

  it("never fails the save when the fetch it was handed throws synchronously", async () => {
    const fetchImpl = (() => {
      throw new Error("defective fetch");
    }) as unknown as OutboundFetch;
    const incoming = server();
    const ctx = await run(incoming, { fetchImpl, calls: [] });
    expectUntouched(ctx.newState, incoming);
  });
});

describe("CompleteEndpointAuth: anything the author says about auth is left alone, unprobed", () => {
  it.each([
    ["a declared env variable", server({ headers: { Authorization: "Bearer ${TOKEN}" }, env: { TOKEN: { isSecret: true } } })],
    ["a placeholder header without an env declaration", server({ headers: { "X-Api-Key": "${KEY}" } })],
    ["a literal Authorization header, in any case", server({ headers: { authorization: "Bearer pasted-token" } })],
    ["an auth block of the author's own", server({ auth: { targetEnvVar: "MY_TOKEN" }, env: { MY_TOKEN: { isSecret: true } } })],
    ["a stdio server", server({ stdio: true })],
  ])("does not probe %s", async (_label, incoming) => {
    const fake = answering(401, { "www-authenticate": CHALLENGE });
    const ctx = await run(incoming, fake);
    expect(fake.calls).toHaveLength(0);
    expect(ctx.newState.metadata?.labels[MCP_AUTH_LABEL]).toBeUndefined();
  });

  it("adds the Bearer header for a hand-written auth whose headers do not send the token, and leaves one that does", async () => {
    const fake = answering(401, { "www-authenticate": CHALLENGE });
    const bare = await run(server({ auth: { targetEnvVar: "MY_TOKEN" }, env: { MY_TOKEN: { isSecret: true } } }), fake);
    expect(bare.newState.spec?.serverType.case === "http" ? bare.newState.spec.serverType.value.headers : {}).toEqual({ Authorization: "Bearer ${MY_TOKEN}" });
    const custom = await run(server({ auth: { targetEnvVar: "MY_TOKEN" }, env: { MY_TOKEN: { isSecret: true } }, headers: { "X-Token": "${MY_TOKEN}" } }), fake);
    expect(custom.newState.spec?.serverType.case === "http" ? custom.newState.spec.serverType.value.headers : {}).toEqual({ "X-Token": "${MY_TOKEN}" });
    expect(fake.calls).toHaveLength(0);
  });
});

describe("CompleteEndpointAuth: carry-over on update, three questions in order", () => {
  it("reuses an earlier completion for the author's shape at the same URL, with no network", async () => {
    const fake = answering(401, { "www-authenticate": CHALLENGE });
    const ctx = await run(server(), fake, completedRow());
    expectCompleted(ctx.newState);
    expect(fake.calls).toHaveLength(0);
    expect(serverStampedReservedLabels(ctx).has(MCP_AUTH_LABEL)).toBe(true);
  });

  it("keeps the label on an exact echo of the derived trio (the console's per-field save), with no network", async () => {
    const fake = answering(401, { "www-authenticate": CHALLENGE });
    const echo = completedRow();
    echo.spec!.description = "edited in the console";
    const ctx = await run(echo, fake, completedRow());
    expect(ctx.newState.metadata?.labels[MCP_AUTH_LABEL]).toBe(MCP_AUTH_ENDPOINT);
    expect(ctx.newState.spec?.description).toBe("edited in the console");
    expect(fake.calls).toHaveLength(0);
    expect(serverStampedReservedLabels(ctx).has(MCP_AUTH_LABEL)).toBe(true);
  });

  it("drops the label when the author alters the derived trio: their auth is theirs now", async () => {
    const fake = answering(401, { "www-authenticate": CHALLENGE });
    const altered = completedRow();
    altered.spec!.auth!.discoveryUrl = "https://login.vendor.test";
    const ctx = await run(altered, fake, completedRow());
    expect(ctx.newState.spec?.auth?.discoveryUrl).toBe("https://login.vendor.test");
    expect(ctx.newState.metadata?.labels[MCP_AUTH_LABEL]).toBeUndefined();
    expect(fake.calls).toHaveLength(0);
  });

  it("drops the label when the author declares their own env on a completed row", async () => {
    const fake = answering(401, { "www-authenticate": CHALLENGE });
    const own = server({ headers: { Authorization: "Bearer ${TOKEN}" }, env: { TOKEN: { isSecret: true } }, labels: { [MCP_AUTH_LABEL]: MCP_AUTH_ENDPOINT } });
    const ctx = await run(own, fake, completedRow());
    expect(ctx.newState.spec?.auth).toBeUndefined();
    expect(ctx.newState.metadata?.labels[MCP_AUTH_LABEL]).toBeUndefined();
    expect(fake.calls).toHaveLength(0);
  });

  it("probes again when the URL changed, and completes from the new answer", async () => {
    const fake = answering(401, { "www-authenticate": CHALLENGE });
    const moved = server({ url: "https://mcp2.vendor.test/mcp" });
    const ctx = await run(moved, fake, completedRow());
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.url).toBe("https://mcp2.vendor.test/mcp");
    expectCompleted(ctx.newState);
  });

  it("probes again when the URL changed, and drops the label when the new endpoint is open", async () => {
    const fake = answering(200);
    const moved = server({ url: "https://open.vendor.test/mcp", labels: { [MCP_AUTH_LABEL]: MCP_AUTH_ENDPOINT } });
    const ctx = await run(moved, fake, completedRow());
    expect(fake.calls).toHaveLength(1);
    expect(ctx.newState.spec?.auth).toBeUndefined();
    expect(ctx.newState.metadata?.labels[MCP_AUTH_LABEL]).toBeUndefined();
  });

  it("does not reuse a completion from a row that lacks the label (an author's own auth is not a completion)", async () => {
    const fake = answering(200);
    const authored = completedRow();
    delete authored.metadata!.labels[MCP_AUTH_LABEL];
    const incoming = server();
    const ctx = await run(incoming, fake, authored);
    expect(fake.calls).toHaveLength(1);
    expectUntouched(ctx.newState, incoming);
  });
});

describe("accessTokenVariable", () => {
  it("upper-cases the slug and folds every non-alphanumeric run into one underscore", () => {
    expect(accessTokenVariable("linear")).toBe("LINEAR_ACCESS_TOKEN");
    expect(accessTokenVariable("my-plugin.github-mcp")).toBe("MY_PLUGIN_GITHUB_MCP_ACCESS_TOKEN");
    expect(accessTokenVariable("--odd--")).toBe("ODD_ACCESS_TOKEN");
    expect(accessTokenVariable("")).toBe("MCP_ACCESS_TOKEN");
  });
});
