// In-process integration test for the delete tools. Verifies the two-step
// resolve→delete flow forwards the resolved id into the correct per-domain
// delete-input shape: typed {value} for agent/skill/workflow, and
// ApiResourceDeleteInput {resource_id} for mcp_server and environment.

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
import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentCommandController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/command_pb";
import { EnvironmentQueryController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/query_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { configureLogger } from "../logger";
import { createServer } from "../server";

configureLogger({ level: "error", format: "text" });

const resolvedAgent = create(AgentSchema, {
  apiVersion: "v1",
  kind: "agent",
  metadata: { name: "Code Reviewer", slug: "code-reviewer", org: "acme", id: "agt-123" },
});
const resolvedMcpServer = create(McpServerSchema, {
  apiVersion: "v1",
  kind: "mcp_server",
  metadata: { name: "GitHub", slug: "github", org: "acme", id: "mcp-456" },
});
const resolvedEnvironment = create(EnvironmentSchema, {
  apiVersion: "v1",
  kind: "environment",
  metadata: { name: "GitHub Creds", slug: "github-creds", org: "acme", id: "env-789" },
});

let backend: Http2Server;
let client: Client;
let deletedAgentId: string | undefined;
let deletedMcpResourceId: string | undefined;
let deletedEnvironmentResourceId: string | undefined;
const openSessions = new Set<ServerHttp2Session>();

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(AgentQueryController, { getByReference: () => resolvedAgent });
    router.service(AgentCommandController, {
      delete: (req) => {
        deletedAgentId = req.value;
        return resolvedAgent;
      },
    });
    router.service(McpServerQueryController, { getByReference: () => resolvedMcpServer });
    router.service(McpServerCommandController, {
      delete: (req) => {
        deletedMcpResourceId = req.resourceId;
        return resolvedMcpServer;
      },
    });
    router.service(EnvironmentQueryController, { getByReference: () => resolvedEnvironment });
    router.service(EnvironmentCommandController, {
      delete: (req) => {
        deletedEnvironmentResourceId = req.resourceId;
        return resolvedEnvironment;
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

  const mcp = createServer({ serverAddress: `127.0.0.1:${port}`, apiKey: "" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "deletes-integration", version: "test" });
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client?.close();
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

describe("delete tools integration", () => {
  it("advertises every delete tool", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "delete_agent",
        "delete_skill",
        "delete_workflow",
        "delete_mcp_server",
        "delete_environment",
      ]),
    );
  });

  it("delete_agent resolves the id then deletes via the typed AgentId", async () => {
    const result = await callTool("delete_agent", { org: "acme", slug: "code-reviewer" });
    expect(result.isError).toBeFalsy();
    expect(deletedAgentId).toBe("agt-123");
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual(
      toJson(AgentSchema, resolvedAgent, { useProtoFieldName: true }),
    );
  });

  it("delete_mcp_server resolves the id then deletes via ApiResourceDeleteInput", async () => {
    const result = await callTool("delete_mcp_server", { org: "acme", slug: "github" });
    expect(result.isError).toBeFalsy();
    expect(deletedMcpResourceId).toBe("mcp-456");
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual(
      toJson(McpServerSchema, resolvedMcpServer, { useProtoFieldName: true }),
    );
  });

  it("delete_environment resolves the id then deletes via ApiResourceDeleteInput", async () => {
    const result = await callTool("delete_environment", { org: "acme", slug: "github-creds" });
    expect(result.isError).toBeFalsy();
    expect(deletedEnvironmentResourceId).toBe("env-789");
  });
});
