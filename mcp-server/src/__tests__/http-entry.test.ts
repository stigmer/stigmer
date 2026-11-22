// The `@stigmer/mcp-server/http` entry (src/http.ts): the handler a host
// that runs unbundled mounts, its options declared structurally.
//
// Pins that the entry's handler is the package's own (it serves the memory
// roster on its route and refuses a missing bearer when auth is required),
// and that its exports are exactly the handler and the logger switch, so the
// built entry's surface stays what its declaration file names. The built
// bundle itself is loaded under plain Node by the open-source server's lane
// tests (backend/services/stigmer-server/src/transport/mcp/__tests__).

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import * as entry from "../http.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

async function serve(options: entry.McpHttpHandlerOptions): Promise<string> {
  entry.configureLogger({ level: "error", format: "json" });
  const handler = entry.createMcpHttpHandler(options);
  const server = createServer((req, res) => void handler(req, res));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const OAUTH_OFF = {
  enabled: false,
  resource: "",
  authorizationServers: [],
  scopesSupported: [],
};

async function listTools(url: string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      connection: "close",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    }),
  });
}

describe("the ./http entry", () => {
  it("exports the handler and the logger switch, nothing else", () => {
    expect(Object.keys(entry).sort()).toEqual([
      "configureLogger",
      "createMcpHttpHandler",
    ]);
  });

  it("serves the package's memory roster on its route", async () => {
    const base = await serve({
      target: { serverAddress: "127.0.0.1:1", apiKey: "" },
      authRequired: false,
      oauth: OAUTH_OFF,
    });
    const answer = (await (await listTools(`${base}/memory`)).json()) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(answer.result.tools.map((tool) => tool.name)).toEqual(["remember"]);
  });

  it("refuses a missing bearer when auth is required", async () => {
    const base = await serve({
      target: { serverAddress: "127.0.0.1:1", apiKey: "" },
      authRequired: true,
      oauth: OAUTH_OFF,
      authenticate: async () => "accepted",
    });
    expect((await listTools(`${base}/memory`)).status).toBe(401);
  });
});
