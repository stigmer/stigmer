/**
 * Pins the connect-time rules a conversation without a computer adds
 * (`shared/mcp-manager.ts`), through the real adapter:
 *  - reach: every HTTP server an agent or a plugin names is judged by the
 *    strict rule before anything is dialled (a loopback or private literal,
 *    a name resolving to one, any one of several addresses), and one
 *    refused fails with `McpReachError` naming it; a server whose address
 *    the runner chose (a bridge, the server's inferred lane, an eval try's
 *    stand-in) and a stdio server are not judged, and no rule applies
 *    without `reach`;
 *  - the inferred lane: an inferred platform server that does not answer is
 *    reported in `unanswered` and the connect succeeds, while a configured
 *    one, or any other server, that does not answer still fails it.
 */
import { createServer } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assertServersReachable, connectMcpServers, McpReachError } from "../mcp-manager.js";
import type { ResolvedMcpServer } from "../mcp-resolver.js";

const PUBLIC = "203.0.113.10";

/** A lookup that answers from a table, so no test resolves a real name. */
function lookupFrom(table: Readonly<Record<string, readonly string[]>>) {
  return async (hostname: string): Promise<readonly string[]> => {
    const addresses = table[hostname];
    if (addresses === undefined) throw new Error(`ENOTFOUND ${hostname}`);
    return addresses;
  };
}

const lookup = lookupFrom({
  "mcp.example.com": [PUBLIC],
  "intranet.example.com": ["10.1.2.3"],
  "split.example.com": [PUBLIC, "192.168.0.7"],
});

function http(slug: string, url: string, extra: Partial<ResolvedMcpServer> = {}): ResolvedMcpServer {
  return { slug, connectionType: "http", url, home: { kind: "agent", agentId: "agt_a", subagent: null, server: slug }, ...extra };
}

/** A local port nothing listens on: bound, then closed. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("assertServersReachable (strict)", () => {
  it.each([
    ["a loopback literal", "http://127.0.0.1:3000/mcp"],
    ["localhost", "http://localhost:3000/mcp"],
    ["an IPv6 loopback", "http://[::1]:3000/mcp"],
    ["a private literal over https", "https://192.168.1.20/mcp"],
    ["the cloud metadata address", "http://169.254.169.254/mcp"],
    ["a name that resolves privately", "https://intranet.example.com/mcp"],
    ["a name with one private address among public ones", "https://split.example.com/mcp"],
  ])("refuses %s, naming the server", async (_what, url) => {
    const refused = assertServersReachable([http("crm", url)], "strict", lookupFrom({ localhost: ["127.0.0.1"], "intranet.example.com": ["10.1.2.3"], "split.example.com": [PUBLIC, "192.168.0.7"] }));
    await expect(refused).rejects.toBeInstanceOf(McpReachError);
    await expect(refused).rejects.toThrow(/^MCP server 'crm' is refused: a conversation without a computer reaches no machine of its own, so it doesn't reach the one it runs on or the private network around it\. Refusing to reach .+ Use a server on a public address, or give the agent a computer\.$/);
  });

  it("names no address a name resolved to", async () => {
    await expect(assertServersReachable([http("crm", "https://intranet.example.com/mcp")], "strict", lookup)).rejects.toThrow(
      "Refusing to reach intranet.example.com: it does not resolve to a public address.",
    );
  });

  it("passes a server on a public address, a stdio server, and every server whose address the runner chose", async () => {
    await expect(
      assertServersReachable(
        [
          http("public", "https://mcp.example.com/mcp"),
          { slug: "local", connectionType: "stdio", command: "npx", home: { kind: "plugin", pluginId: "p", plugin: "p", server: "local" } },
          http("stigmer_memory", "http://localhost:7234/v1/mcp/memory", { home: { kind: "platform" }, addressedByRunner: "inferred" }),
          http("stigmer_channels", "http://10.0.0.5/channels", { home: { kind: "platform" }, addressedByRunner: "known" }),
          http("stand_in", "http://127.0.0.1:41234/mcp/crm", { addressedByRunner: "known" }),
        ],
        "strict",
        lookup,
      ),
    ).resolves.toBeUndefined();
  });
});

describe("connectMcpServers", () => {
  it("refuses before dialling anything when reach is strict", async () => {
    const port = await closedPort();
    const refused = connectMcpServers([http("crm", `http://127.0.0.1:${port}/mcp`)], { reach: "strict", lookup });
    await expect(refused).rejects.toBeInstanceOf(McpReachError);
  });

  it("judges nothing without a reach rule: a loopback server is dialled, and failing to connect fails as before", async () => {
    const port = await closedPort();
    const failed = connectMcpServers([http("crm", `http://127.0.0.1:${port}/mcp`)]);
    await expect(failed).rejects.not.toBeInstanceOf(McpReachError);
    await expect(failed).rejects.toThrow(/crm/);
  });

  it("runs without an inferred platform server that does not answer, and reports it", async () => {
    const port = await closedPort();
    const url = `http://127.0.0.1:${port}/v1/mcp/memory`;
    const result = await connectMcpServers(
      [http("stigmer_memory", url, { home: { kind: "platform" }, addressedByRunner: "inferred" })],
      { reach: "strict", lookup },
    );
    expect(result.unanswered).toEqual([{ slug: "stigmer_memory", url }]);
    expect(result.tools).toEqual([]);
    await result.client.close();
  });

  it("still fails on a configured bridge that does not answer", async () => {
    const port = await closedPort();
    const failed = connectMcpServers([
      http("stigmer_memory", `http://127.0.0.1:${port}/memory`, { home: { kind: "platform" }, addressedByRunner: "known" }),
    ]);
    await expect(failed).rejects.toThrow(/stigmer_memory/);
  });

  it("still fails on any other server that does not answer beside an inferred one", async () => {
    const port = await closedPort();
    const failed = connectMcpServers([
      http("stigmer_memory", `http://127.0.0.1:${port}/v1/mcp/memory`, { home: { kind: "platform" }, addressedByRunner: "inferred" }),
      http("crm", `http://127.0.0.1:${port}/mcp`),
    ]);
    await expect(failed).rejects.toThrow(/crm/);
  });
});
