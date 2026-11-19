// The wire contract of the server's tool list: the `tools/list` answer of
// every roster (full, channels, conversation, memory) as another agent
// receives it, recorded as a file snapshot so a dependency upgrade (zod, the
// MCP SDK's schema serializer) cannot change an advertised input schema
// without a reviewed diff.
//
// Listing tools never calls the backend, so the target is an unreachable
// address. Regenerate ONLY after a deliberate change to what the tools
// advertise:
//   npx vitest run src/__tests__/tools-list-wire.test.ts -u

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";

import { configureLogger } from "../logger";
import {
  createChannelsServer,
  createConversationServer,
  createMemoryServer,
  createServer,
} from "../server";
import { EMPTY_CAPTURE_CONTEXT } from "../domains/memory/context";

configureLogger({ level: "error", format: "text" });

const UNREACHABLE = { serverAddress: "127.0.0.1:1", apiKey: "" };

async function listedTools(server: McpServer): Promise<unknown> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "wire-test", version: "test" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    return (await client.listTools()).tools;
  } finally {
    await client.close();
  }
}

describe("tools/list on the wire", () => {
  it("every roster advertises its recorded tools and input schemas", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const rosters: Array<[string, McpServer]> = [
      ["full", createServer(UNREACHABLE)],
      ["channels", createChannelsServer(UNREACHABLE)],
      ["conversation", createConversationServer(UNREACHABLE)],
      ["memory", createMemoryServer(UNREACHABLE, EMPTY_CAPTURE_CONTEXT)],
    ];

    // ── Act ──────────────────────────────────────────────────────────────────
    const recorded: Record<string, unknown> = {};
    for (const [label, server] of rosters) recorded[label] = await listedTools(server);

    // ── Assert ───────────────────────────────────────────────────────────────
    await expect(JSON.stringify(recorded, null, 2) + "\n").toMatchFileSnapshot("./goldens/tools-list-wire.json");
  });
});
