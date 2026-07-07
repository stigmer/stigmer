// In-process integration test for post-apply MCP discovery.
//
// Stands up a Connect backend serving McpServerCommandController.connect, points
// an SDK node client at it, and drives discoverAppliedMcpServers. The mock
// mirrors the backend's protovalidate rule (org min_len=1) by rejecting an empty
// org, so a regression that drops org from ConnectInput is caught here rather
// than silently passing (issue #140: the CLI used to omit org entirely).

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import type { ConnectInput } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { createNodeClient, normalizeEndpoint } from "@stigmer/sdk/node";
import { createServer as createHttp2Server, type Http2Server, type ServerHttp2Session } from "node:http2";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { discoverAppliedMcpServers } from "./discovery.js";

let backend: Http2Server;
let client: Stigmer;
const openSessions = new Set<ServerHttp2Session>();

let connectCalls: ConnectInput[] = [];

beforeEach(() => {
  connectCalls = [];
});

// A stdio MCP server with no env declarations, so discovery does not skip it and
// buildRuntimeEnv stays empty (no local process needed — connect is mocked).
function stdioServer(id: string, org: string) {
  return create(McpServerSchema, {
    metadata: { id, name: id, slug: id, org },
    spec: { serverType: { case: "stdio", value: { command: "noop" } } },
  });
}

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(McpServerCommandController, {
      connect: (req) => {
        if (req.org === "") {
          throw new ConnectError("org – value length must be at least 1 characters", Code.InvalidArgument);
        }
        connectCalls.push(req);
        return create(McpServerSchema, { metadata: { id: req.mcpServerId } });
      },
    });
  };

  backend = createHttp2Server(connectNodeAdapter({ routes }));
  backend.on("session", (session) => {
    openSessions.add(session);
    session.on("close", () => openSessions.delete(session));
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const port = (backend.address() as AddressInfo).port;
  client = createNodeClient({ baseUrl: normalizeEndpoint(`127.0.0.1:${port}`) });
});

afterAll(async () => {
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

describe("discoverAppliedMcpServers", () => {
  it("forwards the resolved org on ConnectInput for each applied stdio server", async () => {
    const lines: string[] = [];
    await discoverAppliedMcpServers(client, [stdioServer("mcp_1", "acme")], "acme", (l) => lines.push(l));

    expect(connectCalls).toHaveLength(1);
    expect(connectCalls[0].mcpServerId).toBe("mcp_1");
    expect(connectCalls[0].org).toBe("acme");
    expect(lines.join("\n")).toContain("Discovered capabilities for mcp_1");
  });

  it("surfaces the backend's org validation as a per-server warning when org is empty (regression guard)", async () => {
    const lines: string[] = [];
    await discoverAppliedMcpServers(client, [stdioServer("mcp_1", "acme")], "", (l) => lines.push(l));

    // Best-effort: an empty org must never crash the apply — it degrades to a
    // warning. This proves the mock (and thus the backend) rejects empty org, so
    // the happy-path org assertion above is a real guard, not a tautology.
    expect(connectCalls).toHaveLength(0);
    expect(lines.join("\n")).toContain("Discovery failed for mcp_1");
  });

  it("skips non-stdio servers without calling connect", async () => {
    const httpServer = create(McpServerSchema, {
      metadata: { id: "mcp_http", name: "http", slug: "http", org: "acme" },
      spec: { serverType: { case: "http", value: { url: "https://example.com/mcp" } } },
    });
    await discoverAppliedMcpServers(client, [httpServer], "acme");
    expect(connectCalls).toHaveLength(0);
  });
});
