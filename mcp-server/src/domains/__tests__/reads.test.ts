// In-process test for the read tools (get_agent, get_skill). Stands
// up a real Connect
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
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { SkillQueryController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/query_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { configureLogger } from "../../logger";
import { createServer } from "../../server";

configureLogger({ level: "error", format: "text" });

const knownSkill = create(SkillSchema, {
  apiVersion: "v1",
  kind: "skill",
  metadata: { name: "Code Review", slug: "code-review", org: "acme", id: "skl-1" },
});



let backend: Http2Server;
let client: Client;
let lastSkillVersion: string | undefined;
let lastSkillOrg: string | undefined;
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
    router.service(SkillQueryController, {
      getByReference: (req) => {
        lastSkillVersion = req.version;
        lastSkillOrg = req.org;
        return knownSkill;
      },
    });
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
        "get_skill",
      ]),
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

  it("get_skill with no org sends an empty org for the server to fill", async () => {
    const result = await callTool("get_skill", { slug: "code-review" });
    expect(result.isError).toBeFalsy();
    expect(lastSkillOrg).toBe("");
  });
});
