/**
 * The Cursor-specific last hop over the resolved servers: the SDK config
 * projection (`toCursorMcpConfig`) and the env pre-flight
 * (`validateMcpServerEnv`), which names a plugin's server that did not
 * resolve by its turn name, `plugin_<plugin>_<server>`. Resolution itself
 * (naming, values, the transport guard) is pinned once on the shared
 * resolver (shared/__tests__/mcp-resolver.test.ts).
 */
import { describe, it, expect } from "vitest";
import { create } from "@bufbuild/protobuf";
import { PluginSchema, type Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { ResolvedMcpServer } from "../../../shared/mcp-resolver.js";
import { toCursorMcpConfig, validateMcpServerEnv } from "../cursor-mcp-config.js";

function server(overrides: Partial<ResolvedMcpServer>): ResolvedMcpServer {
  return {
    slug: "plugin_github_api",
    connectionType: "http",
    url: "https://mcp.example.com/mcp",
    pluginOrigin: { pluginId: "plg_github", plugin: "github", server: "api" },
    ...overrides,
  };
}

/** The `github` plugin carrying one server named `server`. */
function plugin(server = "api"): Plugin {
  return create(PluginSchema, {
    metadata: { id: "plg_github", name: "github" },
    status: { mcpServers: [{ name: server, transport: { case: "http", value: { url: "https://mcp.example.com/mcp" } } }] },
  });
}

describe("toCursorMcpConfig", () => {
  it("projects an http server to a url config", () => {
    const config = toCursorMcpConfig([
      server({ headers: { Authorization: "Bearer x" } }),
    ]);

    expect(config.plugin_github_api).toEqual({
      type: "http",
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer x" },
    });
  });

  it("projects a stdio server to a command config", () => {
    const config = toCursorMcpConfig([
      server({
        slug: "local-tool",
        connectionType: "stdio",
        url: undefined,
        command: "npx",
        args: ["-y", "tool"],
        env: { API_KEY: "k" },
        cwd: "/work",
      }),
    ]);

    expect(config["local-tool"]).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "tool"],
      env: { API_KEY: "k" },
      cwd: "/work",
    });
  });

  it("skips servers missing their transport's required field", () => {
    const config = toCursorMcpConfig([
      server({ url: undefined }),
      server({ slug: "no-cmd", connectionType: "stdio", url: undefined, command: undefined }),
    ]);

    expect(config).toEqual({});
  });

  it("never narrows a server's config by tool — a server config has no tool filter; tool lists bind in the hook", () => {
    const config = toCursorMcpConfig([server({})]);

    expect(config.plugin_github_api).toEqual({
      type: "http",
      url: "https://mcp.example.com/mcp",
      headers: undefined,
    });
  });
});

describe("validateMcpServerEnv", () => {
  it("warns for a plugin's server that failed to resolve, by its turn name", () => {
    const warnings = validateMcpServerEnv([], [plugin("srv one")]);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("'plugin_github_srv_one'");
    expect(warnings[0]).toContain("failed to resolve");
  });

  it("warns for a stdio server carrying empty env values", () => {
    const warnings = validateMcpServerEnv(
      [server({
        connectionType: "stdio",
        url: undefined,
        command: "npx",
        env: { API_KEY: "", OTHER: "set" },
      })],
      [plugin()],
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("[API_KEY]");
  });

  it("stays quiet for healthy servers", () => {
    const warnings = validateMcpServerEnv([server({})], [plugin()]);

    expect(warnings).toEqual([]);
  });
});
