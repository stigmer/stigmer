// Unit arms for the MCP tool fixture's path-named tool surfaces (entry
// 20260910.02): the default `/mcp` stays the one-tool echo server every
// existing suite pins by exact tool list, an explicit `/mcp/echo,fail` exposes
// both, and an unknown name is refused rather than served as a guess. Driven
// over loopback with the real MCP client; no runner, no target.
// Domain: conformance harness (execution engine).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ECHO_TOOL_NAME, FAIL_TOOL_NAME, McpToolFixture, toolsForPath } from "../mcp-server";

const fixture = new McpToolFixture();

beforeAll(async () => {
  await fixture.start();
});

afterAll(async () => {
  await fixture.close();
});

async function connect(url: string): Promise<Client> {
  const client = new Client({ name: "conformance-unit", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

describe("toolsForPath", () => {
  it("maps the bare path to the echo-only surface and an explicit list to exactly those tools", () => {
    expect(toolsForPath("/mcp")).toEqual([ECHO_TOOL_NAME]);
    expect(toolsForPath("/mcp/echo,fail")).toEqual([ECHO_TOOL_NAME, FAIL_TOOL_NAME]);
    expect(toolsForPath("/mcp/fail")).toEqual([FAIL_TOOL_NAME]);
  });

  it("refuses an unknown tool name or a foreign path", () => {
    expect(toolsForPath("/mcp/echo,crash")).toBeUndefined();
    expect(toolsForPath("/other")).toBeUndefined();
  });
});

describe("McpToolFixture tool surfaces", () => {
  it("serves only echo at the default url — the surface the connect suite pins by exact list", async () => {
    const client = await connect(fixture.url());
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual([ECHO_TOOL_NAME]);
    } finally {
      await client.close();
    }
  });

  it("serves echo and fail at the two-tool url, and fail answers a tool error carrying its message", async () => {
    const client = await connect(fixture.url([ECHO_TOOL_NAME, FAIL_TOOL_NAME]));
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([ECHO_TOOL_NAME, FAIL_TOOL_NAME]);

      const result = await client.callTool({ name: FAIL_TOOL_NAME, arguments: { message: "boom" } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("boom");
    } finally {
      await client.close();
    }
  });

  it("refuses an unknown surface by name", async () => {
    const response = await fetch(`${fixture.url()}/nope`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("unknown tool surface");
  });
});
