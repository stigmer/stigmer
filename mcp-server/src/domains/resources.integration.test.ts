// In-process integration test for the resource templates. Verifies template
// discovery, that each read returns the backend protojson as a single
// application/json entry, and that the skill templates resolve latest (empty
// version) vs a pinned version.

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

const agent = create(AgentSchema, { apiVersion: "v1", kind: "agent", metadata: { slug: "a", org: "acme" } });
const mcpServer = create(McpServerSchema, {
  apiVersion: "v1",
  kind: "mcp_server",
  metadata: { slug: "m", org: "acme" },
});
const skill = create(SkillSchema, { apiVersion: "v1", kind: "skill", metadata: { slug: "s", org: "acme" } });
const workflow = create(WorkflowSchema, {
  apiVersion: "v1",
  kind: "workflow",
  metadata: { slug: "w", org: "acme" },
});
const environment = create(EnvironmentSchema, {
  apiVersion: "v1",
  kind: "environment",
  metadata: { slug: "e", org: "acme" },
});
const datastore = create(DatastoreSchema, {
  apiVersion: "v1",
  kind: "datastore",
  metadata: { slug: "d", org: "acme" },
});

let backend: Http2Server;
let client: Client;
let lastSkillVersion: string | undefined;
const openSessions = new Set<ServerHttp2Session>();

interface ResourceResult {
  contents: Array<{ uri: string; mimeType?: string; text?: string }>;
}

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(AgentQueryController, { getByReference: () => agent });
    router.service(McpServerQueryController, { getByReference: () => mcpServer });
    router.service(SkillQueryController, {
      getByReference: (req) => {
        lastSkillVersion = req.version;
        return skill;
      },
    });
    router.service(WorkflowQueryController, { getByReference: () => workflow });
    router.service(EnvironmentQueryController, { getByReference: () => environment });
    router.service(DatastoreQueryController, { getByReference: () => datastore });
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
  client = new Client({ name: "resources-integration", version: "test" });
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client?.close();
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

describe("resource templates integration", () => {
  it("advertises every template", async () => {
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.name)).toEqual(
      expect.arrayContaining([
        "stigmer_agent",
        "stigmer_mcp_server",
        "stigmer_skill",
        "stigmer_skill_version",
        "stigmer_workflow",
        "stigmer_environment",
        "stigmer_datastore",
      ]),
    );
  });

  it("reads an agent resource", async () => {
    const result = (await client.readResource({ uri: "stigmer://agents/acme/a" })) as ResourceResult;
    expect(result.contents[0]?.mimeType).toBe("application/json");
    expect(JSON.parse(result.contents[0]?.text ?? "{}")).toEqual(
      toJson(AgentSchema, agent, { useProtoFieldName: true }),
    );
  });

  it("reads an mcp-server resource", async () => {
    const result = (await client.readResource({
      uri: "stigmer://mcp-servers/acme/m",
    })) as ResourceResult;
    expect(JSON.parse(result.contents[0]?.text ?? "{}")).toEqual(
      toJson(McpServerSchema, mcpServer, { useProtoFieldName: true }),
    );
  });

  it("reads a workflow resource", async () => {
    const result = (await client.readResource({
      uri: "stigmer://workflows/acme/w",
    })) as ResourceResult;
    expect(JSON.parse(result.contents[0]?.text ?? "{}")).toEqual(
      toJson(WorkflowSchema, workflow, { useProtoFieldName: true }),
    );
  });

  it("reads the latest skill (empty version)", async () => {
    const result = (await client.readResource({ uri: "stigmer://skills/acme/s" })) as ResourceResult;
    expect(JSON.parse(result.contents[0]?.text ?? "{}")).toEqual(
      toJson(SkillSchema, skill, { useProtoFieldName: true }),
    );
    expect(lastSkillVersion).toBe("");
  });

  it("reads a pinned skill version", async () => {
    await client.readResource({ uri: "stigmer://skills/acme/s/v2.0.0" });
    expect(lastSkillVersion).toBe("v2.0.0");
  });

  it("reads an environment resource", async () => {
    const result = (await client.readResource({
      uri: "stigmer://environments/acme/e",
    })) as ResourceResult;
    expect(JSON.parse(result.contents[0]?.text ?? "{}")).toEqual(
      toJson(EnvironmentSchema, environment, { useProtoFieldName: true }),
    );
  });

  it("reads a datastore resource", async () => {
    const result = (await client.readResource({
      uri: "stigmer://datastores/acme/d",
    })) as ResourceResult;
    expect(JSON.parse(result.contents[0]?.text ?? "{}")).toEqual(
      toJson(DatastoreSchema, datastore, { useProtoFieldName: true }),
    );
  });
});
