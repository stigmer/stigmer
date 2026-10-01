// In-process integration test for the MCP server (the tester gate).
//
// Stands up a real in-process Connect server for AgentQueryController, points
// the MCP server at it, drives it through an in-memory MCP client, and asserts:
//   - tools/list advertises get_agent
//   - get_agent returns the agent's protojson, byte-comparable (after parse)
//     with the canonical toJson — the parity contract (DD-005).

import { create, toJson } from "@bufbuild/protobuf";
import type { ConnectRouter } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import {
  createServer as createHttp2Server,
  type Http2Server,
  type ServerHttp2Session,
} from "node:http2";
import type { AddressInfo } from "node:net";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { configureLogger } from "./logger";
import { createServer } from "./server";

configureLogger({ level: "error", format: "text" });

const knownAgent = create(AgentSchema, {
  apiVersion: "v1",
  kind: "agent",
  metadata: { name: "Code Reviewer", slug: "code-reviewer", org: "stigmer", id: "agt-123" },
});

let backend: Http2Server;
let client: Client;
const openSessions = new Set<ServerHttp2Session>();

beforeAll(async () => {
  // Real in-process Connect (gRPC-web over h2c) backend serving the controller.
  const routes = (router: ConnectRouter) =>
    router.service(AgentQueryController, { getByReference: () => knownAgent });
  backend = createHttp2Server(connectNodeAdapter({ routes }));
  // Track keep-alive sessions so teardown can force them closed (otherwise
  // backend.close() blocks on the per-call transports' idle connections).
  backend.on("session", (session) => {
    openSessions.add(session);
    session.on("close", () => openSessions.delete(session));
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const port = (backend.address() as AddressInfo).port;

  const mcp = createServer({ serverAddress: `127.0.0.1:${port}`, apiKey: "" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "integration", version: "test" });
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client?.close();
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

describe("MCP server integration", () => {
  it("advertises get_agent", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("get_agent");
  });

  it("get_agent returns protojson matching the canonical toJson output", async () => {
    const result = (await client.callTool({
      name: "get_agent",
      arguments: { org: "stigmer", slug: "code-reviewer" },
    })) as { content: Array<{ type: string; text?: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0]?.text ?? "{}");
    expect(parsed).toEqual(toJson(AgentSchema, knownAgent, { useProtoFieldName: true }));
  });
});
