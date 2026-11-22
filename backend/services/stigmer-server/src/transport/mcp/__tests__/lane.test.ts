/**
 * The platform MCP lane on the unified port (transport/mcp/lane.ts),
 * through a real `createUnifiedPortServer` and the package's real handler
 * from `@stigmer/mcp-server/http`:
 *
 *   - routing: `/v1/mcp/memory`, `/channels` and `/conversation` reach the
 *     package's rosters with the prefix stripped (a query kept); the
 *     package's full roster (`/v1/mcp/`) and any other path under the
 *     prefix are the lane's 404; with no lane installed the prefix is the
 *     adapter's 404, as every unknown path is;
 *   - the door, where the server signs callers in: no bearer and an
 *     unclaimed bearer are 401, a verifier fault 503, a claimed bearer
 *     served; where it trusts every local caller, no bearer is served;
 *   - before the server listens, 503; an HTTP/2 request, 505.
 *
 * No backend is dialled: `initialize` and `tools/list` are answered by
 * the roster itself.
 */
import { connect } from "node:http2";

import { afterEach, describe, expect, it } from "vitest";

import { createLogger } from "../../../boot/logger.js";
import type {
  CallerIdentity,
  IdentityVerifier,
} from "../../../extensions/identity.js";
import {
  createUnifiedPortServer,
  type UnifiedPortServer,
} from "../../server.js";
import {
  bearerCheck,
  createPlatformMcpLane,
  PLATFORM_MCP_HTTP2_REFUSED,
  PLATFORM_MCP_NOT_LISTENING,
  PLATFORM_MCP_UNKNOWN_ROUTE,
  type PlatformMcpAuthentication,
} from "../lane.js";

const logger = createLogger({ level: "error", pretty: false, write: () => {} });

const person: CallerIdentity = {
  identityId: "ida_person",
  callerClass: "user",
  issuer: "test",
  rawToken: "person",
};

/** Claims `person`, passes every other token, and throws on `fault`. */
const verifier: IdentityVerifier = {
  name: "test",
  verify: (token) => {
    if (token === "fault")
      return Promise.reject(new Error("key set unreachable"));
    return Promise.resolve(token === "person" ? person : null);
  },
};

const running: UnifiedPortServer[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.shutdown()));
});

/** A unified port with the lane installed (or not), listening on loopback. */
async function serve(options: {
  readonly lane: boolean;
  readonly authentication?: PlatformMcpAuthentication;
  readonly listening?: boolean;
}): Promise<string> {
  let bound: number | undefined;
  const server = createUnifiedPortServer({
    logger,
    routes: () => {},
    interceptors: [],
    modelRegistryLane: (_request, response) => response.end("{}"),
    ...(options.lane
      ? {
          platformMcpLane: createPlatformMcpLane({
            logger,
            backendPort: () =>
              options.listening === false ? undefined : bound,
            authentication: options.authentication ?? { required: false },
          }),
        }
      : {}),
  });
  running.push(server);
  bound = await server.listen(0, "127.0.0.1");
  return `http://127.0.0.1:${bound}`;
}

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "lane-test", version: "1" },
  },
};

const TOOLS_LIST = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };

async function post(
  url: string,
  body: unknown,
  bearer?: string,
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      // Each test shuts its server down; a kept-alive socket would hold
      // the drain open.
      connection: "close",
      ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
    },
    body: JSON.stringify(body),
  });
}

/** The tool names a roster lists. */
async function toolNames(response: Response): Promise<string[]> {
  const answer = (await response.json()) as {
    result?: { tools?: Array<{ name: string }> };
  };
  return (answer.result?.tools ?? []).map((tool) => tool.name);
}

describe("platform MCP lane: routing", () => {
  it("serves each platform roster with the prefix stripped, a query kept", async () => {
    const base = await serve({ lane: true });
    expect(
      await toolNames(await post(`${base}/v1/mcp/memory`, TOOLS_LIST)),
    ).toEqual(["remember"]);
    expect(
      await toolNames(await post(`${base}/v1/mcp/channels?x=1`, TOOLS_LIST)),
    ).toEqual(["send_channel_message"]);
    expect(
      await toolNames(await post(`${base}/v1/mcp/conversation`, TOOLS_LIST)),
    ).toEqual(["escalate_to_human"]);
  });

  it("refuses the package's full roster and any other path under the prefix", async () => {
    const base = await serve({ lane: true });
    for (const path of [
      "/v1/mcp/",
      "/v1/mcp/memory/x",
      "/v1/mcp/agents",
      "/v1/mcp//memory",
    ]) {
      const response = await post(`${base}${path}`, TOOLS_LIST);
      expect(response.status, path).toBe(404);
      expect(await response.text()).toBe(PLATFORM_MCP_UNKNOWN_ROUTE);
    }
  });

  it("is the adapter's 404 when no unit declares the lane", async () => {
    const base = await serve({ lane: false });
    const response = await post(`${base}/v1/mcp/memory`, TOOLS_LIST);
    expect(response.status).toBe(404);
    expect(await response.text()).not.toBe(PLATFORM_MCP_UNKNOWN_ROUTE);
  });

  it("answers 503 before the server listens", async () => {
    const base = await serve({ lane: true, listening: false });
    const response = await post(`${base}/v1/mcp/memory`, INITIALIZE);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe(PLATFORM_MCP_NOT_LISTENING);
  });

  it("answers an HTTP/2 request 505", async () => {
    const base = await serve({ lane: true });
    const session = connect(base);
    try {
      const { status, body } = await new Promise<{
        status: number;
        body: string;
      }>((resolve, reject) => {
        const stream = session.request({
          ":method": "POST",
          ":path": "/v1/mcp/memory",
          "content-type": "application/json",
        });
        let status = 0;
        let body = "";
        stream.on("response", (headers) => {
          status = Number(headers[":status"]);
        });
        stream.setEncoding("utf8");
        stream.on("data", (chunk: string) => {
          body += chunk;
        });
        stream.on("end", () => resolve({ status, body }));
        stream.on("error", reject);
        stream.end(JSON.stringify(INITIALIZE));
      });
      expect(status).toBe(505);
      expect(body).toBe(PLATFORM_MCP_HTTP2_REFUSED);
    } finally {
      session.close();
    }
  });
});

describe("platform MCP lane: the door", () => {
  const signedIn: PlatformMcpAuthentication = {
    required: true,
    identityVerifiers: [verifier],
  };

  it("refuses a request with no bearer where the server signs callers in", async () => {
    const base = await serve({ lane: true, authentication: signedIn });
    expect((await post(`${base}/v1/mcp/memory`, INITIALIZE)).status).toBe(401);
  });

  it("refuses a bearer no verifier claims", async () => {
    const base = await serve({ lane: true, authentication: signedIn });
    expect(
      (await post(`${base}/v1/mcp/memory`, INITIALIZE, "stranger")).status,
    ).toBe(401);
  });

  it("answers 503, never 401, when a verifier fails", async () => {
    const base = await serve({ lane: true, authentication: signedIn });
    expect(
      (await post(`${base}/v1/mcp/memory`, INITIALIZE, "fault")).status,
    ).toBe(503);
  });

  it("serves a claimed bearer", async () => {
    const base = await serve({ lane: true, authentication: signedIn });
    expect(
      await toolNames(
        await post(`${base}/v1/mcp/memory`, TOOLS_LIST, "person"),
      ),
    ).toEqual(["remember"]);
  });

  it("serves a request with no bearer where the server trusts every local caller", async () => {
    const base = await serve({
      lane: true,
      authentication: { required: false },
    });
    expect((await post(`${base}/v1/mcp/memory`, INITIALIZE)).status).toBe(200);
  });
});

describe("bearerCheck", () => {
  it("maps the chain's three outcomes to the package's verdicts", async () => {
    const check = bearerCheck([verifier], logger);
    expect(await check("person")).toBe("accepted");
    expect(await check("stranger")).toBe("refused");
    expect(await check("fault")).toBe("unavailable");
  });
});
