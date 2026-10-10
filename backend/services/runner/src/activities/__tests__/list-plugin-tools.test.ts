/**
 * Pins the tools listing's activity (activities/list-plugin-tools.ts), the
 * one step of the pinned `stigmer/mcp-server/connect` workflow: its one
 * registered name, how it finds the server (by its name in the plugin, named
 * `plugin_<plugin>_<server>` to the MCP client), the destructive mark each
 * listed tool carries (an explicit `destructiveHint: true` and nothing else),
 * the transport guard before any connection, the listing's values (fetched
 * for the attempt with the payload's token, taken only from this server's own
 * group, refused when its URL moved), the credential-delivery failures
 * (issue #239), the anonymous caller sentinel, the platform address fill, and
 * the heartbeat and idle-watchdog contract.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import type { Connection } from "@langchain/mcp-adapters";
import { PluginSchema, type Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { McpServerEntrySchema, type McpServerEntry } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { EnvVarDeclarationSchema, type EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";
import {
  ExecutionValuesSchema,
  type ExecutionValues,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/values_pb";

import { testConfig } from "../../__test-utils__/config-fixture.js";
import type { StigmerClient } from "../../client/stigmer-client.js";
import type { PlatformEndpoints } from "../../shared/platform-server-address.js";
import { McpTransportError, type McpTransportPosture } from "../../shared/mcp-transport-guard.js";
import {
  createListPluginToolsActivities,
  CredentialResolutionError,
  listPluginTools,
  type ListPluginToolsInput,
} from "../list-plugin-tools.js";

const mcp = vi.hoisted(() => ({
  configs: [] as Record<string, unknown>[],
  initializeConnections: vi.fn(),
  getClient: vi.fn(),
  close: vi.fn(),
  heartbeatStop: vi.fn(),
}));

vi.mock("@langchain/mcp-adapters", () => ({
  MultiServerMCPClient: vi.fn().mockImplementation((config: Record<string, unknown>) => {
    mcp.configs.push(config);
    return { initializeConnections: mcp.initializeConnections, getClient: mcp.getClient, close: mcp.close };
  }),
}));

vi.mock("../../idle-watchdog.js", () => ({
  activityStarted: vi.fn(),
  activityFinished: vi.fn(),
}));

// The factory starts a Temporal heartbeat loop; outside an activity context
// its ticks would throw, so replace it with a stop-spy and assert the
// start/stop contract instead.
vi.mock("../../shared/heartbeat.js", () => ({
  startHeartbeat: vi.fn(() => ({ stop: mcp.heartbeatStop, cancelled: false, workerShutdown: false })),
}));

// A failed HTTP listing re-probes the endpoint for a sign-in challenge; keep
// that deterministic (its own behaviour is pinned in mcp-oauth-detect's tests).
vi.mock("../../shared/mcp-oauth-detect.js", () => ({
  detectOAuthChallenge: vi.fn().mockResolvedValue(null),
}));

const PLUGIN_ID = "plg-linear";
const PLUGIN_NAME = "linear";
const SLUG = "plugin_linear_api";

interface FakeClient {
  readonly getPlugin: Mock<(pluginId: string) => Promise<Plugin>>;
  readonly fetchExecutionValues: Mock<(executionId: string, token?: string) => Promise<ExecutionValues>>;
}

interface ListedToolFixture {
  readonly name: string;
  readonly description?: string;
  readonly annotations?: { readonly destructiveHint?: boolean; readonly readOnlyHint?: boolean };
}

function stdioEntry(name: string, env: string[] = []): McpServerEntry {
  return create(McpServerEntrySchema, { name, env, transport: { case: "stdio", value: { command: "npx", args: ["-y", "srv"] } } });
}

function httpEntry(name: string, url: string, headers: Record<string, string> = {}, env: string[] = []): McpServerEntry {
  return create(McpServerEntrySchema, { name, env, transport: { case: "http", value: { url, headers } } });
}

function declaration(init: { optional?: boolean; isSecret?: boolean } = {}): EnvVarDeclaration {
  return create(EnvVarDeclarationSchema, init);
}

function pluginWith(entries: McpServerEntry[], env: Record<string, EnvVarDeclaration> = {}): Plugin {
  return create(PluginSchema, {
    metadata: { id: PLUGIN_ID, name: PLUGIN_NAME, slug: PLUGIN_NAME },
    status: { mcpServers: entries, env },
  });
}

/** A client whose fetch answers `values` as the server's own group at the URL it dials, or the whole `answer`. */
function fakeClient(plugin: Plugin, opts: { values?: Record<string, string>; answer?: ExecutionValues; server?: string } = {}): FakeClient {
  const server = opts.server ?? "api";
  const entry = plugin.status?.mcpServers.find((candidate) => candidate.name === server);
  const url = entry?.transport.case === "http" ? entry.transport.value.url : "";
  const answer =
    opts.answer ??
    create(ExecutionValuesSchema, {
      tools: opts.values === undefined ? [] : [{ pluginId: PLUGIN_ID, server, url, values: opts.values }],
    });
  return {
    getPlugin: vi.fn<(pluginId: string) => Promise<Plugin>>().mockResolvedValue(plugin),
    fetchExecutionValues: vi.fn<(executionId: string, token?: string) => Promise<ExecutionValues>>().mockResolvedValue(answer),
  };
}

function serverListing(tools: readonly ListedToolFixture[]): void {
  mcp.initializeConnections.mockResolvedValue({});
  mcp.getClient.mockResolvedValue({ listTools: vi.fn().mockResolvedValue({ tools }) });
}

function run(
  client: FakeClient,
  input: Partial<ListPluginToolsInput> = {},
  opts: { posture?: McpTransportPosture; endpoints?: PlatformEndpoints } = {},
) {
  return listPluginTools(
    { pluginId: PLUGIN_ID, server: "api", ...input },
    {
      stigmerClient: client as unknown as StigmerClient,
      transportPosture: opts.posture ?? "stdio-allowed",
      platformEndpoints: opts.endpoints ?? testConfig(),
    },
  );
}

/** The connection the listing handed the MCP client for the server. */
function connectionOf(slug = SLUG): Connection {
  const connection = mcp.configs[0]?.[slug];
  if (connection === undefined) throw new Error(`no connection for '${slug}' in ${JSON.stringify(Object.keys(mcp.configs[0] ?? {}))}`);
  return connection as Connection;
}

function envOf(connection: Connection): Record<string, string> | undefined {
  if (!("command" in connection)) throw new Error("not a stdio connection");
  return connection.env;
}

function headersOf(connection: Connection): Record<string, string> | undefined {
  if (!("url" in connection)) throw new Error("not an http connection");
  return connection.headers;
}

beforeEach(() => {
  vi.clearAllMocks();
  mcp.configs.length = 0;
  mcp.close.mockResolvedValue(undefined);
});

describe("the activity factory", () => {
  it("registers exactly 'DiscoverMcpServerCapabilities', the pinned wire name", () => {
    expect(Object.keys(createListPluginToolsActivities(testConfig()))).toEqual(["DiscoverMcpServerCapabilities"]);
  });

  it("starts a heartbeat and the idle watchdog for the activity and stops both, even when the listing fails", async () => {
    // The workflow proxies the activity with a 60s heartbeatTimeout: without a
    // heartbeat a slow stdio cold start would die opaquely (issues #239, #243).
    const { startHeartbeat } = await import("../../shared/heartbeat.js");
    const { activityStarted, activityFinished } = await import("../../idle-watchdog.js");
    const { DiscoverMcpServerCapabilities } = createListPluginToolsActivities(testConfig());

    // testConfig's backend dials nothing, so reading the plugin fails.
    await expect(DiscoverMcpServerCapabilities({ pluginId: PLUGIN_ID, server: "api" })).rejects.toThrow();

    expect(startHeartbeat).toHaveBeenCalledTimes(1);
    expect(mcp.heartbeatStop).toHaveBeenCalledTimes(1);
    expect(activityStarted).toHaveBeenCalledTimes(1);
    expect(activityFinished).toHaveBeenCalledTimes(1);
  });
});

describe("listing one server of a plugin", () => {
  it("finds the server by its name in the plugin, names it plugin_<plugin>_<server>, and marks only an explicit destructiveHint", async () => {
    // Annotations are untrusted: read only in the direction that adds a
    // question, so a spoofed readOnlyHint never clears a destructive mark,
    // and an unannotated tool (MCP's own default: destructive) gates nothing.
    const plugin = pluginWith([stdioEntry("other"), stdioEntry("api")]);
    serverListing([
      { name: "drop_table", description: "Drops", annotations: { destructiveHint: true } },
      { name: "spoofed", annotations: { destructiveHint: true, readOnlyHint: true } },
      { name: "read_rows", annotations: { readOnlyHint: true } },
      { name: "explicit_false", annotations: { destructiveHint: false } },
      { name: "unannotated" },
    ]);

    const result = await run(fakeClient(plugin));

    expect(Object.keys(mcp.configs[0] ?? {})).toEqual([SLUG]);
    expect(mcp.getClient).toHaveBeenCalledWith(SLUG);
    expect(result).toEqual({
      tools: [
        { name: "drop_table", description: "Drops", destructiveHint: true },
        { name: "spoofed", description: "", destructiveHint: true },
        { name: "read_rows", description: "", destructiveHint: false },
        { name: "explicit_false", description: "", destructiveHint: false },
        { name: "unannotated", description: "", destructiveHint: false },
      ],
    });
  });

  it("refuses a server the plugin does not carry, naming the plugin and the server", async () => {
    const promise = run(fakeClient(pluginWith([stdioEntry("other")])));
    await expect(promise).rejects.toThrow("plugin 'linear' has no MCP server named 'api'");
    expect(mcp.initializeConnections).not.toHaveBeenCalled();
  });

  it("refuses to start a local program under a forbidding transport posture, before connecting", async () => {
    const promise = run(fakeClient(pluginWith([stdioEntry("api")])), {}, { posture: "stdio-forbidden" });
    await expect(promise).rejects.toThrow(McpTransportError);
    expect(mcp.initializeConnections).not.toHaveBeenCalled();
  });

  it("closes the MCP client when the listing fails", async () => {
    mcp.initializeConnections.mockRejectedValue(new Error("Connection refused"));
    await expect(run(fakeClient(pluginWith([stdioEntry("api")])))).rejects.toThrow("Connection refused");
    expect(mcp.close).toHaveBeenCalledTimes(1);
  });
});

describe("the listing's values", () => {
  const url = "https://mcp.linear.app/mcp";
  const authHeader = { Authorization: "Bearer ${LINEAR_TOKEN}" };
  const requiresToken = () => pluginWith([httpEntry("api", url, authHeader, ["LINEAR_TOKEN"])], { LINEAR_TOKEN: declaration({ isSecret: true }) });

  it("fetches the attempt's values with the payload-carried token, and templates the server from its own group", async () => {
    const client = fakeClient(requiresToken(), { values: { LINEAR_TOKEN: "lin-123" } });
    serverListing([]);

    await run(client, { executionContextId: "att-1", executionContextToken: "scoped-token" });

    expect(client.fetchExecutionValues).toHaveBeenCalledWith("att-1", "scoped-token");
    expect(headersOf(connectionOf())).toEqual({ Authorization: "Bearer lin-123" });
  });

  it("fetches nothing when no attempt is named", async () => {
    const client = fakeClient(pluginWith([stdioEntry("api")]));
    serverListing([]);
    await run(client);
    expect(client.fetchExecutionValues).not.toHaveBeenCalled();
  });

  it("takes nothing from another server's group of the same plugin, and fails closed for a required key", async () => {
    const plugin = pluginWith(
      [httpEntry("api", url, authHeader, ["LINEAR_TOKEN"]), httpEntry("other", url, authHeader, ["LINEAR_TOKEN"])],
      { LINEAR_TOKEN: declaration({ isSecret: true }) },
    );
    const client = fakeClient(plugin, { values: { LINEAR_TOKEN: "theirs" }, server: "other" });

    const promise = run(client, { executionContextId: "att-2" });
    await expect(promise).rejects.toThrow(CredentialResolutionError);
    await expect(promise).rejects.toThrow(`MCP server '${SLUG}' requires LINEAR_TOKEN, but the listing received no credentials`);
    expect(mcp.initializeConnections).not.toHaveBeenCalled();
  });

  it("sends nothing when the server's URL moved since its values were checked", async () => {
    const answer = create(ExecutionValuesSchema, {
      tools: [{ pluginId: PLUGIN_ID, server: "api", url: "https://elsewhere.example/mcp", values: { LINEAR_TOKEN: "lin-123" } }],
    });
    const promise = run(fakeClient(requiresToken(), { answer }), { executionContextId: "att-3" });
    await expect(promise).rejects.toThrow(CredentialResolutionError);
    await expect(promise).rejects.toThrow(`MCP server '${SLUG}' changed its URL while its tools were being listed`);
    expect(mcp.initializeConnections).not.toHaveBeenCalled();
  });

  it("fails closed when the fetch errors and the server requires a key (issue #239)", async () => {
    const client = fakeClient(requiresToken());
    client.fetchExecutionValues.mockRejectedValue(new Error("PERMISSION_DENIED: not scope-bound"));

    const promise = run(client, { executionContextId: "att-4" });
    await expect(promise).rejects.toThrow(CredentialResolutionError);
    await expect(promise).rejects.toThrow(/requires \(LINEAR_TOKEN\).*PERMISSION_DENIED: not scope-bound/s);
    expect(mcp.initializeConnections).not.toHaveBeenCalled();
  });

  it.each([
    ["declares no key", pluginWith([httpEntry("api", url)])],
    [
      "declares only optional keys",
      pluginWith([httpEntry("api", url, {}, ["REGION"])], { REGION: declaration({ optional: true }) }),
    ],
  ])("lists anyway when the fetch errors and the server %s", async (_label, plugin) => {
    const client = fakeClient(plugin);
    client.fetchExecutionValues.mockRejectedValue(new Error("transient"));
    serverListing([{ name: "t" }]);

    const result = await run(client, { executionContextId: "att-5" });
    expect(result.tools.map((tool) => tool.name)).toEqual(["t"]);
  });

  it("carries the server's own refusal verbatim, naming the server", async () => {
    const client = fakeClient(requiresToken());
    client.fetchExecutionValues.mockRejectedValue(
      new ConnectError("linear needs LINEAR_TOKEN: add LINEAR_TOKEN to My vault", Code.FailedPrecondition),
    );

    const promise = run(client, { executionContextId: "att-6" });
    await expect(promise).rejects.toThrow(CredentialResolutionError);
    await expect(promise).rejects.toThrow(`MCP server '${SLUG}': linear needs LINEAR_TOKEN: add LINEAR_TOKEN to My vault`);
  });

  it("answers a caller-identity-templating server as the anonymous caller: a listing has no conversation", async () => {
    const plugin = pluginWith(
      [
        httpEntry(
          "api",
          url,
          {
            "X-Stigmer-Caller-Kind": "${STIGMER_CALLER_IDENTITY_KIND}",
            "X-Stigmer-Caller-Value": "${STIGMER_CALLER_IDENTITY_VALUE}",
            Authorization: "Bearer ${SHARED_SECRET}",
          },
          ["STIGMER_CALLER_IDENTITY_KIND", "STIGMER_CALLER_IDENTITY_VALUE", "SHARED_SECRET"],
        ),
      ],
      {
        STIGMER_CALLER_IDENTITY_KIND: declaration({ optional: true }),
        STIGMER_CALLER_IDENTITY_VALUE: declaration({ optional: true }),
        SHARED_SECRET: declaration({ isSecret: true }),
      },
    );
    serverListing([{ name: "get_info" }]);

    await run(fakeClient(plugin, { values: { SHARED_SECRET: "s3cret" } }), { executionContextId: "att-7" }, { posture: "stdio-forbidden" });

    expect(headersOf(connectionOf())).toEqual({
      "X-Stigmer-Caller-Kind": "anonymous",
      "X-Stigmer-Caller-Value": "",
      Authorization: "Bearer s3cret",
    });
  });
});

describe("the platform's STIGMER_SERVER_ADDRESS fill", () => {
  const required = { STIGMER_SERVER_ADDRESS: declaration() };

  it("fills a local program's required address from the runner's backend endpoint instead of failing closed", async () => {
    serverListing([]);
    await run(fakeClient(pluginWith([stdioEntry("api", ["STIGMER_SERVER_ADDRESS"])], required), { values: {} }), {
      executionContextId: "att-8",
    });
    // testConfig's backend endpoint is http://127.0.0.1:1.
    expect(envOf(connectionOf())?.STIGMER_SERVER_ADDRESS).toBe("127.0.0.1:1");
  });

  it("templates an address server's header from the operator's public endpoint", async () => {
    const plugin = pluginWith(
      [httpEntry("api", "https://mcp.example.com", { "X-Stigmer-Server": "${STIGMER_SERVER_ADDRESS}" }, ["STIGMER_SERVER_ADDRESS"])],
      required,
    );
    serverListing([]);
    await run(fakeClient(plugin, { values: {} }), { executionContextId: "att-9" }, {
      endpoints: testConfig({ mcpPublicEndpoint: "https://api.example.com" }),
    });
    expect(headersOf(connectionOf())).toEqual({ "X-Stigmer-Server": "api.example.com:443" });
  });

  it("never hands an address server the backend endpoint: without a public one its required address is a credential the listing owes", async () => {
    const plugin = pluginWith([httpEntry("api", "https://mcp.example.com", {}, ["STIGMER_SERVER_ADDRESS"])], required);
    const promise = run(fakeClient(plugin, { values: {} }), { executionContextId: "att-10" });
    await expect(promise).rejects.toThrow(CredentialResolutionError);
    await expect(promise).rejects.toThrow(/STIGMER_SERVER_ADDRESS/);
  });
});
