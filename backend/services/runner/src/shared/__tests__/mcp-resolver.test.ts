/**
 * Pins how a turn resolves its plugins' MCP servers: each server named as
 * Claude Code names it (`plugin_<plugin>_<server>`) and carrying its plugin
 * origin; the transport guard failing a whole resolution rather than
 * skipping a server; each server filled only from its own group of the
 * run's values (keyed by its plugin and its name there) and only while it
 * dials the URL that group was checked against; the platform values spread
 * over a server's own; and the platform address fill (stigmer#1433).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { create } from "@bufbuild/protobuf";
import { PluginSchema, type Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import {
  HttpMcpServerSchema,
  McpServerEntrySchema,
  PluginStatusSchema,
  StdioMcpServerSchema,
  type McpServerEntry,
} from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { declaredKeysOf, declaredServerCount, dialedUrlOf, entryToResolved, resolvePluginServers } from "../mcp-resolver.js";
import { toolValuesKey, type ToolValueGroup } from "../run-values.js";
import { McpTransportError } from "../mcp-transport-guard.js";
import { testConfig } from "../../__test-utils__/config-fixture.js";

/** A run whose fetch answered no tool values. */
const NO_TOOLS: ReadonlyMap<string, ToolValueGroup> = new Map();

/** The runner endpoints resolution fills STIGMER_SERVER_ADDRESS from. */
const PLATFORM_ENDPOINTS = testConfig();

const LINEAR_URL = "https://mcp.example.com/mcp";

function stdioEntry(name: string, env: string[] = [], args: string[] = []): McpServerEntry {
  return create(McpServerEntrySchema, {
    name,
    transport: { case: "stdio", value: create(StdioMcpServerSchema, { command: "npx", args }) },
    env,
  });
}

function httpEntry(name: string, env: string[] = [], headers: Record<string, string> = {}, url = LINEAR_URL): McpServerEntry {
  return create(McpServerEntrySchema, {
    name,
    transport: { case: "http", value: create(HttpMcpServerSchema, { url, headers }) },
    env,
  });
}

function plugin(id: string, name: string, servers: McpServerEntry[]): Plugin {
  return create(PluginSchema, {
    metadata: create(ApiResourceMetadataSchema, { id, name, slug: name }),
    status: create(PluginStatusSchema, { mcpServers: servers }),
  });
}

describe("resolvePluginServers: names and origins", () => {
  it("names each server plugin_<plugin>_<server> and records the plugin it came from", () => {
    const result = resolvePluginServers(
      [plugin("plg_1", "my.tools", [httpEntry("issues"), stdioEntry("local fs")])],
      NO_TOOLS,
      {},
      "stdio-allowed",
      PLATFORM_ENDPOINTS,
    );

    expect(result.resolvedServers.map((server) => [server.slug, server.pluginOrigin])).toEqual([
      ["plugin_my_tools_issues", { pluginId: "plg_1", plugin: "my.tools", server: "issues" }],
      ["plugin_my_tools_local_fs", { pluginId: "plg_1", plugin: "my.tools", server: "local fs" }],
    ]);
  });

  it("resolves every plugin's servers, in plugin order", () => {
    const result = resolvePluginServers(
      [plugin("plg_a", "alpha", [httpEntry("one")]), plugin("plg_b", "beta", [httpEntry("two")])],
      NO_TOOLS,
      {},
      "stdio-forbidden",
      PLATFORM_ENDPOINTS,
    );

    expect(result.resolvedServers.map((server) => server.slug)).toEqual(["plugin_alpha_one", "plugin_beta_two"]);
  });

  it("skips an entry that names neither a command nor a URL", () => {
    const empty = create(McpServerEntrySchema, { name: "nothing" });
    const result = resolvePluginServers([plugin("plg_1", "p", [empty])], NO_TOOLS, {}, "stdio-allowed", PLATFORM_ENDPOINTS);
    expect(result.resolvedServers).toEqual([]);
  });
});

describe("resolvePluginServers: the transport guard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("throws McpTransportError for stdio under a forbidding posture, never a skipped server", () => {
    expect(() =>
      resolvePluginServers([plugin("plg_1", "fs", [stdioEntry("files")])], NO_TOOLS, {}, "stdio-forbidden", PLATFORM_ENDPOINTS),
    ).toThrow(McpTransportError);
  });

  it("fails the whole resolution even when other servers are resolvable", () => {
    expect(() =>
      resolvePluginServers(
        [plugin("plg_1", "mixed", [httpEntry("remote"), stdioEntry("local")])],
        NO_TOOLS,
        {},
        "stdio-forbidden",
        PLATFORM_ENDPOINTS,
      ),
    ).toThrow(McpTransportError);
  });

  it("resolves http servers under a forbidding posture and stdio under an allowing one", () => {
    const http = resolvePluginServers([plugin("plg_1", "p", [httpEntry("remote")])], NO_TOOLS, {}, "stdio-forbidden", PLATFORM_ENDPOINTS);
    expect(http.resolvedServers.map((server) => server.connectionType)).toEqual(["http"]);
    const stdio = resolvePluginServers([plugin("plg_1", "p", [stdioEntry("local")])], NO_TOOLS, {}, "stdio-allowed", PLATFORM_ENDPOINTS);
    expect(stdio.resolvedServers.map((server) => server.connectionType)).toEqual(["stdio"]);
  });

  it("drops a server whose placeholder cannot resolve, keeping the others", () => {
    const result = resolvePluginServers(
      [plugin("plg_1", "p", [httpEntry("needs", ["TOKEN"], { Authorization: "Bearer ${TOKEN}" }), httpEntry("plain")])],
      NO_TOOLS,
      {},
      "stdio-forbidden",
      PLATFORM_ENDPOINTS,
    );
    expect(result.resolvedServers.map((server) => server.slug)).toEqual(["plugin_p_plain"]);
  });
});

describe("resolvePluginServers: each server only from its own values", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("fills a server from its own group by plugin and server name, never from another's", () => {
    const linear = plugin("plg_linear", "linear", [
      httpEntry("api", ["LINEAR_TOKEN"], { Authorization: "Bearer ${LINEAR_TOKEN}" }),
      stdioEntry("cli", ["LINEAR_TOKEN"]),
    ]);
    // Another plugin with a server of the same name: its group is keyed by
    // its own plugin id, so the Linear login never reaches it.
    const other = plugin("plg_other", "other", [stdioEntry("api", ["LINEAR_TOKEN"])]);
    const tools = new Map([[toolValuesKey("plg_linear", "api"), { url: LINEAR_URL, values: { LINEAR_TOKEN: "lin-login" } }]]);

    const result = resolvePluginServers([linear, other], tools, {}, "stdio-allowed", PLATFORM_ENDPOINTS);

    const bySlug = new Map(result.resolvedServers.map((server) => [server.slug, server]));
    expect(bySlug.get("plugin_linear_api")?.headers).toEqual({ Authorization: "Bearer lin-login" });
    expect(bySlug.get("plugin_linear_cli")?.env, "a sibling server of the same plugin").toBeUndefined();
    expect(bySlug.get("plugin_other_api")?.env, "a same-named server of another plugin").toBeUndefined();
  });

  it("passes a server only the keys its entry reads", () => {
    const tools = new Map([[toolValuesKey("plg_1", "cli"), { url: "", values: { READ: "yes", EXTRA: "no" } }]]);
    const result = resolvePluginServers([plugin("plg_1", "p", [stdioEntry("cli", ["READ"])])], tools, {}, "stdio-allowed", PLATFORM_ENDPOINTS);
    expect(result.resolvedServers[0]?.env).toEqual({ READ: "yes" });
  });

  it("gives a server the fetch named no group for no run values", () => {
    const result = resolvePluginServers([plugin("plg_1", "p", [stdioEntry("added", ["API_KEY"])])], NO_TOOLS, {}, "stdio-allowed", PLATFORM_ENDPOINTS);
    expect(result.resolvedServers).toHaveLength(1);
    expect(result.resolvedServers[0]?.env).toBeUndefined();
  });

  it("skips a server whose URL is not the one its values were checked against, naming it and no value", () => {
    const moved = plugin("plg_linear", "linear", [
      httpEntry("api", ["LINEAR_TOKEN"], { Authorization: "Bearer ${LINEAR_TOKEN}" }, "https://attacker.example.net/mcp"),
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tools = new Map([[toolValuesKey("plg_linear", "api"), { url: LINEAR_URL, values: { LINEAR_TOKEN: "lin-login" } }]]);

    const result = resolvePluginServers([moved], tools, {}, "stdio-forbidden", PLATFORM_ENDPOINTS);

    expect(result.resolvedServers).toEqual([]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("plugin_linear_api"));
    expect(JSON.stringify(warn.mock.calls)).not.toContain("lin-login");
  });

  it("skips a local program whose group was checked against a URL", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const tools = new Map([[toolValuesKey("plg_1", "cli"), { url: LINEAR_URL, values: { KEY: "v" } }]]);
    const result = resolvePluginServers([plugin("plg_1", "p", [stdioEntry("cli", ["KEY"])])], tools, {}, "stdio-allowed", PLATFORM_ENDPOINTS);
    expect(result.resolvedServers).toEqual([]);
  });

  it("spreads the platform values over the server's own, so no vault entry impersonates a caller", () => {
    const tools = new Map([[toolValuesKey("plg_1", "who"), { url: "", values: { STIGMER_CALLER_IDENTITY_VALUE: "forged" } }]]);

    const result = resolvePluginServers(
      [plugin("plg_1", "p", [stdioEntry("who", ["STIGMER_CALLER_IDENTITY_VALUE"])])],
      tools,
      { STIGMER_CALLER_IDENTITY_VALUE: "acc_real" },
      "stdio-allowed",
      PLATFORM_ENDPOINTS,
    );

    expect(result.resolvedServers[0]?.env).toEqual({ STIGMER_CALLER_IDENTITY_VALUE: "acc_real" });
  });

  it("resolves a stdio server's arguments from its values", () => {
    const tools = new Map([[toolValuesKey("plg_1", "cli"), { url: "", values: { DIR: "/data" } }]]);
    const result = resolvePluginServers(
      [plugin("plg_1", "p", [stdioEntry("cli", ["DIR"], ["--root", "${DIR}"])])],
      tools,
      {},
      "stdio-allowed",
      PLATFORM_ENDPOINTS,
    );
    expect(result.resolvedServers[0]?.args).toEqual(["--root", "/data"]);
  });
});

describe("an entry's own facts", () => {
  it("reads the URL a server dials: its HTTP URL, or nothing for a local program", () => {
    expect(dialedUrlOf(httpEntry("h"))).toBe(LINEAR_URL);
    expect(dialedUrlOf(stdioEntry("s"))).toBe("");
  });

  it("reads the keys a server declares", () => {
    expect(declaredKeysOf(stdioEntry("s", ["A", "B"]))).toEqual({ A: true, B: true });
  });

  it("maps an entry with the origin it is given, and null for none", () => {
    expect(entryToResolved(httpEntry("h"), "slug", {}, null)).toEqual({
      slug: "slug",
      connectionType: "http",
      url: LINEAR_URL,
      headers: undefined,
      pluginOrigin: null,
    });
  });

  it("counts the servers the agent and session declared, never the platform's own attachments", () => {
    const declared = entryToResolved(httpEntry("h"), "plugin_linear_h", {}, { pluginId: "plg_1", plugin: "linear", server: "h" });
    const attachment = entryToResolved(httpEntry("memory"), "stigmer-memory", {}, null);
    expect(declaredServerCount([declared, attachment].flatMap((server) => (server === null ? [] : [server])))).toBe(1);
    expect(declaredServerCount([])).toBe(0);
  });
});

describe("resolvePluginServers: the platform STIGMER_SERVER_ADDRESS (stigmer/stigmer#1433)", () => {
  it("fills a stdio server's missing address from the runner's backend endpoint", () => {
    const result = resolvePluginServers(
      [plugin("plg_1", "stigmer", [stdioEntry("server", ["STIGMER_SERVER_ADDRESS"])])],
      NO_TOOLS,
      {},
      "stdio-allowed",
      PLATFORM_ENDPOINTS,
    );

    // testConfig's backend endpoint is http://127.0.0.1:1.
    expect(result.resolvedServers[0]?.env).toEqual({ STIGMER_SERVER_ADDRESS: "127.0.0.1:1" });
  });

  it("keeps the address the server's own values carry", () => {
    const result = resolvePluginServers(
      [plugin("plg_1", "stigmer", [stdioEntry("server", ["STIGMER_SERVER_ADDRESS"])])],
      new Map([[toolValuesKey("plg_1", "server"), { url: "", values: { STIGMER_SERVER_ADDRESS: "api.example.com:443" } }]]),
      {},
      "stdio-allowed",
      PLATFORM_ENDPOINTS,
    );

    expect(result.resolvedServers[0]?.env).toEqual({ STIGMER_SERVER_ADDRESS: "api.example.com:443" });
  });

  it("templates an http header from the operator's public endpoint", () => {
    const result = resolvePluginServers(
      [plugin("plg_1", "p", [httpEntry("remote", ["STIGMER_SERVER_ADDRESS"], { "X-Stigmer-Server": "${STIGMER_SERVER_ADDRESS}" })])],
      NO_TOOLS,
      {},
      "stdio-forbidden",
      testConfig({ mcpPublicEndpoint: "https://api.example.com" }),
    );

    expect(result.resolvedServers[0]?.headers).toEqual({ "X-Stigmer-Server": "api.example.com:443" });
  });

  it("never hands an http server the backend endpoint: an unknown address drops it with the named error", () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = resolvePluginServers(
      [plugin("plg_1", "p", [httpEntry("remote", ["STIGMER_SERVER_ADDRESS"], { "X-Stigmer-Server": "${STIGMER_SERVER_ADDRESS}" })])],
      NO_TOOLS,
      {},
      "stdio-forbidden",
      PLATFORM_ENDPOINTS,
    );

    expect(result.resolvedServers).toEqual([]);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("STIGMER_SERVER_ADDRESS"));
    errorLog.mockRestore();
  });
});
