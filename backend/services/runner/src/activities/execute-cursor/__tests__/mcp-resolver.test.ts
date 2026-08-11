import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveMcpServers } from "../mcp-resolver.js";

function makeUsage(
  slug: string,
  enabledTools: string[] = [],
  toolApprovalOverrides: Array<{ toolName: string; requiresApproval: boolean }> = [],
) {
  return {
    mcpServerRef: { slug, org: "test-org", kind: 0 },
    enabledTools,
    toolApprovalOverrides,
  } as any;
}

function httpMcpServer(slug: string, defaultEnabledTools: string[] = []) {
  return {
    metadata: { id: `id-${slug}`, slug },
    spec: {
      serverType: { case: "http", value: { url: "https://mcp.example.com/mcp", headers: {} } },
      env: {},
      defaultEnabledTools,
    },
    status: undefined,
  } as any;
}

function clientReturning(serversBySlug: Record<string, unknown>) {
  return {
    getMcpServerByReference: vi.fn(async (ref: { slug: string }) => {
      const server = serversBySlug[ref.slug];
      if (!server) throw new Error(`not found: ${ref.slug}`);
      return server;
    }),
  } as any;
}

// The effective-list semantics live in shared/mcp-enabled-tools.ts (tested
// there); these tests pin the CURSOR resolver's threading — the near-duplicate
// of shared/mcp-resolver.ts that must mirror it until oss#387 consolidates.
describe("resolveMcpServers (cursor) — enabled_tools threading (issue #350)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("carries the usage's enabled_tools as the effective allow-list", async () => {
    const client = clientReturning({ github: httpMcpServer("github") });

    const result = await resolveMcpServers(
      client, [makeUsage("github", ["create_pr"])], {}, "stdio-forbidden",
    );

    expect(result.resolvedServers[0].enabledTools).toEqual(["create_pr"]);
  });

  it("falls back to default_enabled_tools for an empty usage list", async () => {
    const client = clientReturning({
      github: httpMcpServer("github", ["search_code"]),
    });

    const result = await resolveMcpServers(
      client, [makeUsage("github")], {}, "stdio-forbidden",
    );

    expect(result.resolvedServers[0].enabledTools).toEqual(["search_code"]);
  });

  it("resolves unrestricted (absent field) when both lists are empty", async () => {
    const client = clientReturning({ github: httpMcpServer("github") });

    const result = await resolveMcpServers(
      client, [makeUsage("github")], {}, "stdio-forbidden",
    );

    expect(result.resolvedServers[0].enabledTools).toBeUndefined();
  });

  it("never narrows the Cursor SDK config — the SDK has no allow-list field; enforcement is the hook's disabled arm", async () => {
    const client = clientReturning({ github: httpMcpServer("github") });

    const result = await resolveMcpServers(
      client, [makeUsage("github", ["create_pr"])], {}, "stdio-forbidden",
    );

    expect(result.cursorConfig.github).toEqual({
      type: "http",
      url: "https://mcp.example.com/mcp",
      headers: undefined,
    });
  });
});

describe("resolveMcpServers (cursor) — tool_approval_overrides threading (issue #349)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("carries the usage's overrides on its own resolved server only", async () => {
    // Riding the server is the scoping mechanism: an override can no longer
    // reach a same-named tool on another server, because it never exists
    // anywhere but its own server's object.
    const client = clientReturning({
      github: httpMcpServer("github"),
      slack: httpMcpServer("slack"),
    });

    const result = await resolveMcpServers(
      client,
      [
        makeUsage("github", [], [{ toolName: "delete_item", requiresApproval: false }]),
        makeUsage("slack"),
      ],
      {},
      "stdio-forbidden",
    );

    const bySlug = new Map(result.resolvedServers.map((s) => [s.slug, s]));
    expect(bySlug.get("github")!.toolApprovalOverrides).toEqual([
      { toolName: "delete_item", requiresApproval: false },
    ]);
    expect(bySlug.get("slack")!.toolApprovalOverrides).toEqual([]);
  });
});
