// In-process integration test for the search tool. Verifies resource_uri
// enrichment for every searchable kind, the empty-response short-circuit,
// the unknown-kind validation error, and pagination passthrough.

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
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { PageInfo } from "@stigmer/protos/ai/stigmer/commons/rpc/pagination_pb";
import {
  type SearchResponse,
  SearchResponseSchema,
  SearchResultSchema,
} from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { SearchService } from "@stigmer/protos/ai/stigmer/search/v1/query_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { configureLogger } from "../../logger";
import { createServer } from "../../server";

configureLogger({ level: "error", format: "text" });

const allKindsResponse = create(SearchResponseSchema, {
  entries: [
    create(SearchResultSchema, { kind: ApiResourceKind.agent, org: "acme", slug: "code-reviewer" }),
    create(SearchResultSchema, { kind: ApiResourceKind.skill, org: "acme", slug: "code-review" }),
    create(SearchResultSchema, { kind: ApiResourceKind.mcp_server, org: "acme", slug: "github" }),
    create(SearchResultSchema, { kind: ApiResourceKind.workflow, org: "acme", slug: "release" }),
    create(SearchResultSchema, {
      kind: ApiResourceKind.environment,
      org: "acme",
      slug: "github-creds",
    }),
  ],
});
const emptyResponse = create(SearchResponseSchema, { entries: [] });

let backend: Http2Server;
let client: Client;
let nextResponse: SearchResponse = allKindsResponse;
let lastPage: PageInfo | undefined;
const openSessions = new Set<ServerHttp2Session>();

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

async function callSearch(args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name: "search", arguments: args })) as ToolResult;
}

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(SearchService, {
      search: (req) => {
        lastPage = req.page;
        return nextResponse;
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
  client = new Client({ name: "search-integration", version: "test" });
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await client?.close();
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

describe("search tool integration", () => {
  it("enriches every kind with a resource_uri", async () => {
    nextResponse = allKindsResponse;
    const result = await callSearch({ query: "code" });
    expect(result.isError).toBeFalsy();
    const data = JSON.parse(result.content[0]?.text ?? "{}") as {
      entries: Array<{ resource_uri?: string }>;
    };
    expect(data.entries.map((e) => e.resource_uri)).toEqual([
      "stigmer://agents/acme/code-reviewer",
      "stigmer://skills/acme/code-review",
      "stigmer://mcp-servers/acme/github",
      "stigmer://workflows/acme/release",
      "stigmer://environments/acme/github-creds",
    ]);
  });

  it("short-circuits an empty response to the plain marshal", async () => {
    nextResponse = emptyResponse;
    const result = await callSearch({ query: "nothing" });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual(
      toJson(SearchResponseSchema, emptyResponse, { useProtoFieldName: true }),
    );
  });

  it("rejects an unknown kind without calling the backend", async () => {
    const result = await callSearch({ kinds: ["bogus"] });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('unknown resource kind "bogus"');
    expect(result.content[0]?.text).toContain(
      "valid kinds: agent, skill, mcp_server, workflow, environment",
    );
  });

  it("accepts the environment kind", async () => {
    nextResponse = emptyResponse;
    const result = await callSearch({ kinds: ["environment"] });
    expect(result.isError).toBeFalsy();
  });

  it("forwards pagination only when requested", async () => {
    nextResponse = allKindsResponse;
    lastPage = undefined;
    await callSearch({ query: "code" });
    expect(lastPage).toBeUndefined();

    await callSearch({ query: "code", page_size: 5, page_num: 2 });
    expect(lastPage).toMatchObject({ size: 5, num: 2 });
  });
});
