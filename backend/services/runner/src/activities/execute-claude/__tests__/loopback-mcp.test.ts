/**
 * Pins the endpoint the host serves the Claude engine its tools from
 * (`loopback-mcp.ts`), as the engine meets it: a real MCP client over
 * streamable HTTP.
 *
 * Why it matters: this endpoint is the one way a tool reaches the engine.
 * A tool's JSON schema must arrive exactly as the tool wrote it; each call
 * must carry the engine's own tool-use id, the key the gate decided it
 * under; and since the endpoint's token can be read by a process of the
 * same user, the token alone runs nothing: every call is admitted by the
 * gate first, and a refused call never reaches its tool. A request without
 * the token, or for a server the endpoint does not serve, is turned away.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

import { startLoopbackMcp, textResult, type ServedCall, type ServedServer } from "../loopback-mcp.js";
import { connectServed, type ServedClient } from "../__test-utils__/served-client.js";

const ECHO: Tool = {
  name: "echo",
  description: "Echo the text.",
  inputSchema: {
    type: "object",
    properties: { text: { type: "string", description: "What to echo." }, times: { type: "integer", minimum: 1 } },
    required: ["text"],
    additionalProperties: false,
  },
};

const open: ServedClient[] = [];

afterEach(async () => {
  for (const served of open.splice(0)) await served.close();
});

function echoServer(calls: ServedCall[], tools: () => readonly Tool[] = () => [ECHO]): ServedServer {
  return {
    name: "probe",
    tools,
    call: async (call) => {
      calls.push(call);
      return textResult(String(call.args.text));
    },
  };
}

async function connect(server: ServedServer, admit?: (call: ServedCall) => string | undefined): Promise<ServedClient> {
  const served = await connectServed([server], admit === undefined ? {} : { admit });
  open.push(served);
  return served;
}

function textOf(result: CallToolResult): string {
  return result.content.map((block) => (block.type === "text" ? block.text : "")).join("");
}

describe("the loopback endpoint", () => {
  it("closes with a session still open, and the client's next call fails", async () => {
    const { client, endpoint } = await connectServed([echoServer([])]);
    await endpoint.close();
    await expect(client.listTools()).rejects.toThrow();
    await client.close().catch(() => undefined);
  });

  it("names each server and lists each tool's JSON schema exactly as written, read on every listing", async () => {
    let tools: Tool[] = [];
    const { client, endpoint } = await connect(echoServer([], () => tools));
    expect(client.getServerVersion()).toEqual({ name: "probe", version: "1.0.0" });
    expect((await client.listTools()).tools).toEqual([]);
    tools = [ECHO];
    expect((await client.listTools()).tools).toEqual([ECHO]);
    const config = endpoint.configs.probe!;
    expect(config.type).toBe("http");
    expect(config.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp\/probe$/);
    expect(config.headers?.Authorization).toMatch(/^Bearer [A-Za-z0-9_-]{43}$/);
  });

  it("hands each call the engine's own id, and '' when the engine sent none", async () => {
    const calls: ServedCall[] = [];
    const { client } = await connect(echoServer(calls));
    const result = (await client.callTool({ name: "echo", arguments: { text: "hi" }, _meta: { "claudecode/toolUseId": "toolu_1" } })) as CallToolResult;
    expect(textOf(result)).toBe("hi");
    await client.callTool({ name: "echo", arguments: { text: "again" } });
    expect(calls).toEqual([
      { server: "probe", tool: "echo", args: { text: "hi" }, toolUseId: "toolu_1" },
      { server: "probe", tool: "echo", args: { text: "again" }, toolUseId: "" },
    ]);
  });

  it("runs only what the gate admits: a refused call never reaches its tool, and the engine reads why", async () => {
    const calls: ServedCall[] = [];
    const asked: ServedCall[] = [];
    const { client } = await connect(echoServer(calls), (call) => {
      asked.push(call);
      return call.toolUseId === "toolu_ok" ? undefined : "The gate allowed no such call; it was not run.";
    });
    const refused = (await client.callTool({ name: "echo", arguments: { text: "x" }, _meta: { "claudecode/toolUseId": "toolu_forged" } })) as CallToolResult;
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toBe("The gate allowed no such call; it was not run.");
    expect(calls).toEqual([]);
    await client.callTool({ name: "echo", arguments: { text: "y" }, _meta: { "claudecode/toolUseId": "toolu_ok" } });
    expect(calls.map((call) => call.toolUseId)).toEqual(["toolu_ok"]);
    expect(asked.map((call) => call.toolUseId)).toEqual(["toolu_forged", "toolu_ok"]);
  });

  it("turns away a request without the token, with another, or for a server it does not serve, and stops when closed", async () => {
    const endpoint = await startLoopbackMcp([echoServer([])], () => undefined);
    const url = endpoint.configs.probe!.url;
    const post = (target: string, authorization?: string) =>
      fetch(target, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(authorization ? { authorization } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } } }),
      });
    expect((await post(url)).status).toBe(401);
    expect((await post(url, "Bearer not-the-token")).status).toBe(401);
    expect((await post(url.replace(/probe$/, "other"), endpoint.configs.probe!.headers!.Authorization)).status).toBe(404);
    const auth = endpoint.configs.probe!.headers!.Authorization;
    expect((await post(url, auth)).status).toBe(200);
    expect((await post(url.replace(/\/mcp\/probe$/, "/other"), auth)).status, "a path outside the endpoint's").toBe(404);
    expect((await post(url.replace(/probe$/, "%E0%A4%A"), auth)).status, "a path that does not decode").toBe(404);
    const stale = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: auth, "mcp-session-id": "no-such-session" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    expect(stale.status, "a session the endpoint never opened").toBe(404);
    await endpoint.close();
    await expect(post(url, endpoint.configs.probe!.headers!.Authorization)).rejects.toThrow();
  });
});
