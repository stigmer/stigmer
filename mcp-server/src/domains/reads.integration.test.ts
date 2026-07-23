// In-process integration test for the read tools (get_mcp_server, get_skill,
// get_workflow, get_environment, get_datastore). Stands up a real Connect
// backend serving the query controllers, drives the MCP server through an
// in-memory client, and asserts each tool returns the backend's protojson
// verbatim (the parity contract) and that get_skill forwards its optional
// version to the backend.

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
import { DatastoreSchema } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/api_pb";
import { DatastoreQueryController } from "@stigmer/protos/ai/stigmer/agentic/datastore/v1/query_pb";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentQueryController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/query_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { SkillQueryController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/query_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowQueryController } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/query_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { configureLogger } from "../logger";
import { createServer } from "../server";

configureLogger({ level: "error", format: "text" });

const knownMcpServer = create(McpServerSchema, {
  apiVersion: "v1",
  kind: "mcp_server",
  metadata: { name: "GitHub", slug: "github", org: "acme", id: "mcp-1" },
});

const knownSkill = create(SkillSchema, {
  apiVersion: "v1",
  kind: "skill",
  metadata: { name: "Code Review", slug: "code-review", org: "acme", id: "skl-1" },
});

const knownWorkflow = create(WorkflowSchema, {
  apiVersion: "v1",
  kind: "workflow",
  metadata: { name: "Release", slug: "release", org: "acme", id: "wkf-1" },
});

// The backend redacts secret values before they leave the server; the tool
// must pass that redaction through verbatim.
const knownEnvironment = create(EnvironmentSchema, {
  apiVersion: "v1",
  kind: "environment",
  metadata: { name: "GitHub Creds", slug: "github-creds", org: "acme", id: "env-1" },
  spec: { data: { API_KEY: { value: "***REDACTED***", isSecret: true } } },
});

const knownDatastore = create(DatastoreSchema, {
  apiVersion: "v1",
  kind: "datastore",
  metadata: { name: "Bookings", slug: "bookings", org: "acme", id: "dst-1" },
});

let backend: Http2Server;
let client: Client;
let lastSkillVersion: string | undefined;
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
    router.service(McpServerQueryController, { getByReference: () => knownMcpServer });
    router.service(SkillQueryController, {
      getByReference: (req) => {
        lastSkillVersion = req.version;
        return knownSkill;
      },
    });
    router.service(WorkflowQueryController, { getByReference: () => knownWorkflow });
    router.service(EnvironmentQueryController, { getByReference: () => knownEnvironment });
    router.service(DatastoreQueryController, { getByReference: () => knownDatastore });
  };
  backend = createHttp2Server(connectNodeAdapter({ routes }));
  // Force keep-alive sessions closed on teardown, else backend.close() blocks.
  backend.on("session", (session) => {
    openSessions.add(session);
    session.on("close", () => openSessions.delete(session));
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const port = (backend.address() as AddressInfo).port;

  const mcp = createServer({ serverAddress: `127.0.0.1:${port}`, apiKey: "" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "reads-integration", version: "test" });
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client?.close();
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

describe("read tools integration", () => {
  it("advertises all read tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "get_agent",
        "get_mcp_server",
        "get_skill",
        "get_workflow",
        "get_environment",
        "get_datastore",
      ]),
    );
  });

  it("get_mcp_server returns the backend protojson", async () => {
    const result = await callTool("get_mcp_server", { org: "acme", slug: "github" });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual(
      toJson(McpServerSchema, knownMcpServer, { useProtoFieldName: true }),
    );
  });

  it("get_workflow returns the backend protojson", async () => {
    const result = await callTool("get_workflow", { org: "acme", slug: "release" });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual(
      toJson(WorkflowSchema, knownWorkflow, { useProtoFieldName: true }),
    );
  });

  it("get_skill returns the backend protojson and defaults version to latest", async () => {
    const result = await callTool("get_skill", { org: "acme", slug: "code-review" });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual(
      toJson(SkillSchema, knownSkill, { useProtoFieldName: true }),
    );
    // Omitted version is forwarded as the empty string ("latest").
    expect(lastSkillVersion).toBe("");
  });

  it("get_skill forwards an explicit version to the backend", async () => {
    await callTool("get_skill", { org: "acme", slug: "code-review", version: "stable" });
    expect(lastSkillVersion).toBe("stable");
  });

  it("get_environment passes the server's secret redaction through verbatim", async () => {
    const result = await callTool("get_environment", { org: "acme", slug: "github-creds" });
    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
    expect(body).toEqual(toJson(EnvironmentSchema, knownEnvironment, { useProtoFieldName: true }));
    const data = (body.spec as { data: Record<string, { value: string }> }).data;
    expect(data.API_KEY?.value).toBe("***REDACTED***");
  });

  it("get_datastore returns the backend protojson", async () => {
    const result = await callTool("get_datastore", { org: "acme", slug: "bookings" });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual(
      toJson(DatastoreSchema, knownDatastore, { useProtoFieldName: true }),
    );
  });
});
