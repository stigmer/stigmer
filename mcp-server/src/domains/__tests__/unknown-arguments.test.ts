// Every tool's input is closed and enforced: an argument the tool does not
// declare is refused with the MCP SDK's validation error (InvalidParams,
// -32602) naming the key, never stripped without a word. One tool per
// domain file, each with otherwise valid arguments, so the refusal is the
// unknown key's alone; the same arguments without it pass validation and
// reach the (unreachable) backend.
//
// The advertised schema says the same thing: each input is
// `additionalProperties: false` (`src/__tests__/goldens/tools-list-wire.json`).

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";

import { configureLogger } from "../../logger";
import { EMPTY_CAPTURE_CONTEXT } from "../memory/context";
import {
  createChannelsServer,
  createConversationServer,
  createMemoryServer,
  createServer,
} from "../../server";

configureLogger({ level: "error", format: "text" });

const UNREACHABLE = { serverAddress: "127.0.0.1:1", apiKey: "" };
const VALIDATION_ERROR = /-32602: Input validation error/;

interface ToolResult {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

async function call(server: McpServer, name: string, args: Record<string, unknown>): Promise<string> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "unknown-arguments", version: "test" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = (await client.callTool({ name, arguments: args })) as ToolResult;
    return result.content[0]?.text ?? "";
  } finally {
    await client.close();
  }
}

const CASES: Array<[family: string, roster: () => McpServer, tool: string, args: Record<string, unknown>]> = [
  ["search", () => createServer(UNREACHABLE), "search", { query: "reviewer" }],
  ["agents", () => createServer(UNREACHABLE), "get_agent", { slug: "code-reviewer" }],
  ["runs", () => createServer(UNREACHABLE), "get_run", { run_id: "run_1" }],
  ["skills", () => createServer(UNREACHABLE), "get_skill", { slug: "web-search" }],
  ["channels", () => createChannelsServer(UNREACHABLE), "send_channel_message", { recipient: "919900000000", text: "hi" }],
  ["conversation", () => createConversationServer(UNREACHABLE), "escalate_to_human", { reason: "needs a person" }],
  ["memory", () => createMemoryServer(UNREACHABLE, EMPTY_CAPTURE_CONTEXT), "remember", { fact: "Prefers Go." }],
];

describe("unknown tool arguments", () => {
  it.each(CASES)("%s: %s refuses an undeclared argument and names it", async (_family, roster, tool, args) => {
    const refused = await call(roster(), tool, { ...args, sluggg: "typo" });

    expect(refused).toMatch(VALIDATION_ERROR);
    expect(refused).toContain("sluggg");
  });

  it.each(CASES)("%s: %s takes the same arguments without it", async (_family, roster, tool, args) => {
    const accepted = await call(roster(), tool, args);

    expect(accepted).not.toMatch(VALIDATION_ERROR);
  });
});
