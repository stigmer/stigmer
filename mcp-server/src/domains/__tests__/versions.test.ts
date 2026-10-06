// In-process test for the versioning tool, list_skill_versions: it forwards
// the reference and returns the timeline. Same harness as reads.test.ts.

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
import { SkillQueryController } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/query_pb";
import {
  ListSkillVersionsResponseSchema,
  type ListSkillVersionsInput,
} from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { configureLogger } from "../../logger";
import { createServer } from "../../server";

configureLogger({ level: "error", format: "text" });

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

const skillVersions = create(ListSkillVersionsResponseSchema, {
  versions: [{ versionHash: HASH_A, tag: "stable", isCurrent: true }],
  totalCount: 1,
});

let backend: Http2Server;
let client: Client;
let lastSkillVersionsRequest: ListSkillVersionsInput | undefined;
const openSessions = new Set<ServerHttp2Session>();

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

function parseText(result: ToolResult): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? "{}") as Record<string, unknown>;
}

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(SkillQueryController, {
      listVersions: (req) => {
        lastSkillVersionsRequest = req;
        return skillVersions;
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
  client = new Client({ name: "versions-integration", version: "test" });
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
});

beforeEach(() => {
  lastSkillVersionsRequest = undefined;
});

afterAll(async () => {
  await client?.close();
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

describe("versioning tools integration", () => {
  it("advertises the versioning tool", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(
      expect.arrayContaining(["list_skill_versions"]),
    );
  });

  it("list_skill_versions forwards the reference and returns the timeline", async () => {
    const result = await callTool("list_skill_versions", {
      org: "acme",
      slug: "code-review",
      page_size: 10,
    });
    expect(result.isError).toBeFalsy();
    expect(lastSkillVersionsRequest?.org).toBe("acme");
    expect(lastSkillVersionsRequest?.slug).toBe("code-review");
    expect(lastSkillVersionsRequest?.pageSize).toBe(10);
    expect(parseText(result)).toEqual(
      toJson(ListSkillVersionsResponseSchema, skillVersions, { useProtoFieldName: true }),
    );
  });
});
