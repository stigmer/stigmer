// In-process test for where a tool call's credential comes from. A real
// Connect backend records the authorization header of every call; the MCP
// server is driven through an in-memory client. It pins the precedence
// resolveToken owns: a per-request bearer (http) first, then the embedder's
// token provider, asked again on every call so a long-running server follows a
// refreshed sign-in, then the fixed API key. A provider answering null sends no
// credential at all. Resource reads resolve their credential the same way.

import { create } from "@bufbuild/protobuf";
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
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { SkillSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { SkillQueryController } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/query_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { configureLogger } from "../../logger";
import { createServer } from "../../server";
import type { BackendTarget } from "../client";

configureLogger({ level: "error", format: "text" });

const knownSkill = create(SkillSchema, {
  apiVersion: "v1",
  kind: "skill",
  metadata: { name: "Code Review", slug: "code-review", org: "acme", id: "skl_1" },
});

let backend: Http2Server;
let serverAddress: string;
const openSessions = new Set<ServerHttp2Session>();
const openClients: Client[] = [];
// The authorization header of each backend call, in order; null when absent.
let seenAuthorization: Array<string | null> = [];

beforeAll(async () => {
  const routes = (router: ConnectRouter) => {
    router.service(SkillQueryController, {
      getByReference: (_req, ctx) => {
        seenAuthorization.push(ctx.requestHeader.get("authorization"));
        return knownSkill;
      },
    });
  };
  backend = createHttp2Server(connectNodeAdapter({ routes }));
  backend.on("session", (session) => {
    openSessions.add(session);
    session.on("close", () => openSessions.delete(session));
  });
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  serverAddress = `127.0.0.1:${(backend.address() as AddressInfo).port}`;
});

afterEach(async () => {
  seenAuthorization = [];
  await Promise.all(openClients.splice(0).map((c) => c.close()));
});

afterAll(async () => {
  for (const session of openSessions) session.destroy();
  await new Promise<void>((resolve) => backend.close(() => resolve()));
});

/**
 * Connect an MCP client to a server built over `target`. With `bearer`, every
 * message the client sends carries it as authInfo, as the http transport does
 * with an inbound Authorization header.
 */
async function connect(
  target: Omit<BackendTarget, "serverAddress">,
  bearer?: string,
): Promise<Client> {
  const mcp = createServer({ serverAddress, ...target });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  if (bearer !== undefined) {
    const send = clientTransport.send.bind(clientTransport);
    clientTransport.send = (message: JSONRPCMessage, options) =>
      send(message, { ...options, authInfo: { token: bearer, clientId: "test", scopes: [] } });
  }
  const client = new Client({ name: "credential-integration", version: "test" });
  await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
  openClients.push(client);
  return client;
}

async function getSkill(client: Client): Promise<void> {
  const result = (await client.callTool({
    name: "get_skill",
    arguments: { org: "acme", slug: "code-review" },
  })) as { isError?: boolean };
  expect(result.isError).toBeFalsy();
}

describe("the credential a call carries", () => {
  it("asks the token provider on every call, so a refreshed token is sent", async () => {
    const tokens = ["t1", "t2"];
    const client = await connect({ apiKey: "", getAccessToken: async () => tokens.shift() ?? null });
    await getSkill(client);
    await getSkill(client);
    expect(seenAuthorization).toEqual(["Bearer t1", "Bearer t2"]);
  });

  it("sends no credential when the provider answers null", async () => {
    const client = await connect({ apiKey: "", getAccessToken: () => null });
    await getSkill(client);
    expect(seenAuthorization).toEqual([null]);
  });

  it("prefers the per-request bearer over the provider", async () => {
    const client = await connect(
      { apiKey: "", getAccessToken: () => "from-provider" },
      "per-request",
    );
    await getSkill(client);
    expect(seenAuthorization).toEqual(["Bearer per-request"]);
  });

  it("uses the fixed API key when no provider is given", async () => {
    const client = await connect({ apiKey: "fixed-key" });
    await getSkill(client);
    expect(seenAuthorization).toEqual(["Bearer fixed-key"]);
  });

  it("resolves a resource read's credential through the provider too", async () => {
    const client = await connect({ apiKey: "", getAccessToken: async () => "resource-token" });
    await client.readResource({ uri: "stigmer://skills/acme/code-review" });
    expect(seenAuthorization).toEqual(["Bearer resource-token"]);
  });
});
