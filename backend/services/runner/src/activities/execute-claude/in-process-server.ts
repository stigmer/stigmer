/**
 * An MCP server that lives in the agent host's own process and that the
 * Claude engine reaches over the SDK's in-process channel: the one way a
 * tool reaches the engine here (`host-shell.ts`, `mcp-bridge.ts`), so no
 * tool is the engine's child and no tool's configuration (a login header, a
 * command) is on the engine's command line, which every user of the machine
 * can read.
 *
 * The MCP SDK's own server, with the two requests the engine sends answered
 * directly (`tools/list`, `tools/call`), so a tool's JSON schema reaches the
 * engine as the tool wrote it. The SDK's typed `tool()` helper is not used:
 * it re-describes every tool in zod 4, which the runner does not carry, and a
 * bridged server's schema needs no second description.
 *
 * Each call carries the engine's own id for it (`_meta["claudecode/toolUseId"]`,
 * measured on SDK 0.3.310): the id the gate decided the call under and the
 * transcript keys its row by, handed to the call so it can read both.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";

/** The `_meta` key the engine puts its tool-use id under. */
const TOOL_USE_ID_META = "claudecode/toolUseId";

/** One call as the server's handler sees it. */
export interface InProcessCall {
  readonly tool: string;
  readonly args: Record<string, unknown>;
  /** The engine's id for the call; "" when the engine sent none. */
  readonly toolUseId: string;
}

/** An in-process server named `name`, listing `tools` and answering each call with `call`. */
export function inProcessServer(name: string, tools: () => readonly Tool[], call: (request: InProcessCall) => Promise<CallToolResult>): McpServer {
  const server = new McpServer({ name, version: "1.0.0" }, { capabilities: { tools: {} } });
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...tools()] }));
  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const meta = request.params._meta as Record<string, unknown> | undefined;
    const toolUseId = typeof meta?.[TOOL_USE_ID_META] === "string" ? meta[TOOL_USE_ID_META] : "";
    return call({ tool: request.params.name, args: request.params.arguments ?? {}, toolUseId });
  });
  return server;
}

/** A call's answer as text, marked an error when it is one. */
export function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}
