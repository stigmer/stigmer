/**
 * Pins the in-process MCP server (`in-process-server.ts`) as the engine
 * meets it: a real MCP client over the SDK's in-memory transport lists the
 * tools and calls one, the way the engine does over its in-process channel.
 *
 * Why it matters: this server is the one way a tool reaches the Claude
 * engine. A tool's JSON schema must arrive exactly as the tool wrote it (no
 * second description), and each call must carry the engine's own tool-use
 * id, the key the gate decided it under, or "" when the engine sent none.
 */

import { describe, it, expect, afterEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { CallToolResultSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";

import { inProcessServer, textResult, type InProcessCall } from "../in-process-server.js";

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

const open: { close(): Promise<void> }[] = [];

afterEach(async () => {
  for (const closable of open.splice(0)) await closable.close();
});

async function connect(tools: () => readonly Tool[], call: (request: InProcessCall) => Promise<CallToolResult>): Promise<Client> {
  const server = inProcessServer("probe", tools, call);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "engine-stand-in", version: "1.0.0" });
  await client.connect(clientTransport);
  open.push(client, server);
  return client;
}

describe("inProcessServer", () => {
  it("names itself and lists each tool's JSON schema exactly as written", async () => {
    const client = await connect(() => [ECHO], async () => textResult(""));
    expect(client.getServerVersion()).toEqual({ name: "probe", version: "1.0.0" });
    const listed = await client.listTools();
    expect(listed.tools).toEqual([ECHO]);
  });

  it("reads the tool list on every request, so a later list reflects the tools then", async () => {
    let tools: Tool[] = [];
    const client = await connect(() => tools, async () => textResult(""));
    expect((await client.listTools()).tools).toEqual([]);
    tools = [ECHO];
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["echo"]);
  });

  it("hands a call its tool, arguments and the engine's tool-use id, and answers with the call's result", async () => {
    const calls: InProcessCall[] = [];
    const client = await connect(
      () => [ECHO],
      async (request) => {
        calls.push(request);
        return textResult(`echo: ${String(request.args.text)}`);
      },
    );
    const result = await client.callTool({ name: "echo", arguments: { text: "hi" }, _meta: { "claudecode/toolUseId": "toolu_01" } }, CallToolResultSchema);
    expect(calls).toEqual([{ tool: "echo", args: { text: "hi" }, toolUseId: "toolu_01" }]);
    expect(result.content).toEqual([{ type: "text", text: "echo: hi" }]);
    expect(result.isError).toBeUndefined();
  });

  it("reads the tool-use id as empty when the engine sent none", async () => {
    const calls: InProcessCall[] = [];
    const client = await connect(
      () => [ECHO],
      async (request) => {
        calls.push(request);
        return textResult("ok");
      },
    );
    await client.callTool({ name: "echo", arguments: { text: "x" } }, CallToolResultSchema);
    expect(calls[0]?.toolUseId).toBe("");
  });

  it("reads a tool-use id that is not a string as empty", async () => {
    const calls: InProcessCall[] = [];
    const client = await connect(
      () => [ECHO],
      async (request) => {
        calls.push(request);
        return textResult("ok");
      },
    );
    await client.callTool({ name: "echo", arguments: { text: "x" }, _meta: { "claudecode/toolUseId": 42 } }, CallToolResultSchema);
    expect(calls[0]?.toolUseId).toBe("");
  });

  it("hands a call with no arguments an empty object", async () => {
    const calls: InProcessCall[] = [];
    const client = await connect(
      () => [ECHO],
      async (request) => {
        calls.push(request);
        return textResult("ok");
      },
    );
    await client.callTool({ name: "echo" }, CallToolResultSchema);
    expect(calls[0]?.args).toEqual({});
  });

  it("carries an error result to the engine marked as an error", async () => {
    const client = await connect(() => [ECHO], async () => textResult("refused", true));
    const result = await client.callTool({ name: "echo", arguments: { text: "x" } }, CallToolResultSchema);
    expect(result).toMatchObject({ content: [{ type: "text", text: "refused" }], isError: true });
  });
});

describe("textResult", () => {
  it("is plain text, with no error mark by default", () => {
    expect(textResult("done")).toEqual({ content: [{ type: "text", text: "done" }] });
  });

  it("marks an error only when asked", () => {
    expect(textResult("bad", true)).toEqual({ content: [{ type: "text", text: "bad" }], isError: true });
    expect(textResult("fine", false)).toEqual({ content: [{ type: "text", text: "fine" }] });
  });
});
