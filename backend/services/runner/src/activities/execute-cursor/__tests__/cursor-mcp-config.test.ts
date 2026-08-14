import { describe, it, expect } from "vitest";
import type { ResolvedMcpServer } from "../../../shared/mcp-resolver.js";
import { toCursorMcpConfig, validateMcpServerEnv } from "../cursor-mcp-config.js";

// Resolution behavior (enabled_tools threading, overrides scoping, the
// transport guard) is pinned once on the single shared resolver
// (shared/__tests__/mcp-resolver.test.ts — oss#387). These tests pin what is
// genuinely Cursor-specific: the SDK config projection and the env pre-flight.

function server(overrides: Partial<ResolvedMcpServer>): ResolvedMcpServer {
  return {
    slug: "github",
    connectionType: "http",
    url: "https://mcp.example.com/mcp",
    toolApprovals: [],
    pinnedToolApprovals: [],
    discoveredCapabilitiesEmpty: false,
    toolApprovalOverrides: [],
    ...overrides,
  };
}

function usage(slug: string) {
  return { mcpServerRef: { slug, org: "test-org", kind: 0 } } as any;
}

describe("toCursorMcpConfig", () => {
  it("projects an http server to a url config", () => {
    const config = toCursorMcpConfig([
      server({ headers: { Authorization: "Bearer x" } }),
    ]);

    expect(config.github).toEqual({
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

  it("never narrows the config for enabledTools — the SDK has no allow-list field; enforcement is the hook's disabled arm", () => {
    const config = toCursorMcpConfig([server({ enabledTools: ["create_pr"] })]);

    expect(config.github).toEqual({
      type: "http",
      url: "https://mcp.example.com/mcp",
      headers: undefined,
    });
  });
});

describe("validateMcpServerEnv", () => {
  it("warns for a usage whose server failed to resolve", () => {
    const warnings = validateMcpServerEnv([], [usage("github")]);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("'github'");
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
      [usage("github")],
    );

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("[API_KEY]");
  });

  it("stays quiet for healthy servers", () => {
    const warnings = validateMcpServerEnv([server({})], [usage("github")]);

    expect(warnings).toEqual([]);
  });
});
