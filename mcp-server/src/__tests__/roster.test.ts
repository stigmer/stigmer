// Every roster as a client sees it, through an in-memory MCP client: each
// tool carries its marks (annotations) with all four hints stated, so no tool
// can be registered without them; the README's tool list names exactly the
// tools each roster registers, with the same marks; and only the full roster
// sends instructions, short enough to ride in every session's prompt.

import { readFileSync } from "node:fs";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Tool, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

import { DESTRUCTIVE, READ, READ_OPEN_WORLD, WRITE, WRITE_IDEMPOTENT, WRITE_OPEN_WORLD } from "../domains/toolmarks";
import { AGENT_RULES, SERVER_INSTRUCTIONS } from "../instructions";
import { configureLogger } from "../logger";
import { createChannelsServer, createConversationServer, createMemoryServer, createServer } from "../server";

configureLogger({ level: "error", format: "text" });

const target = { serverAddress: "127.0.0.1:1", apiKey: "" };

const ROSTERS: Record<string, () => McpServer> = {
  full: () => createServer(target),
  channels: () => createChannelsServer(target),
  conversation: () => createConversationServer(target),
  memory: () => createMemoryServer(target),
};

/** The README's words for each mark set. */
const MARK_WORDS = new Map<string, readonly ToolAnnotations[]>([
  ["read", [READ]],
  ["read, open world", [READ_OPEN_WORLD]],
  ["write", [WRITE, WRITE_IDEMPOTENT]],
  ["write, open world", [WRITE_OPEN_WORLD]],
  ["destructive", [DESTRUCTIVE]],
]);

async function connect(build: () => McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "roster", version: "test" });
  await Promise.all([build().connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function listed(roster: string): Promise<{ tools: Tool[]; instructions: string | undefined }> {
  const client = await connect(ROSTERS[roster] as () => McpServer);
  const { tools } = await client.listTools();
  const instructions = client.getInstructions();
  await client.close();
  return { tools, instructions };
}

/** The README's tool rows: name → { roster, marks }. Full-roster tables have three columns, the narrow table four. */
function readmeTools(): Map<string, { roster: string; marks: string }> {
  const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
  const section = readme.slice(readme.indexOf("## Tools ("), readme.indexOf("## Resources ("));
  const rows = new Map<string, { roster: string; marks: string }>();
  for (const line of section.split("\n")) {
    const cells = line.split("|").map((cell) => cell.trim()).slice(1, -1);
    const name = /^`([a-z_]+)`$/.exec(cells[0] ?? "")?.[1];
    if (name === undefined) continue;
    rows.set(name, cells.length === 4 ? { roster: cells[1] ?? "", marks: cells[2] ?? "" } : { roster: "full", marks: cells[1] ?? "" });
  }
  return rows;
}

describe("every roster's tools", () => {
  it.each(Object.keys(ROSTERS))("%s: each tool carries one of the mark sets, all four hints stated", async (roster) => {
    const { tools } = await listed(roster);
    expect(tools.length).toBeGreaterThan(0);
    const sets = [...MARK_WORDS.values()].flat();
    for (const tool of tools) {
      const marks = tool.annotations;
      expect(marks, `${tool.name} has no annotations`).toBeDefined();
      for (const hint of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const) {
        expect(typeof marks?.[hint], `${tool.name}.${hint}`).toBe("boolean");
      }
      expect(sets, tool.name).toContainEqual(marks);
    }
  });

  it("the README lists exactly the registered tools, each roster's, with their marks", async () => {
    const rows = readmeTools();
    const seen = new Set<string>();
    for (const roster of Object.keys(ROSTERS)) {
      for (const tool of (await listed(roster)).tools) {
        seen.add(tool.name);
        const row = rows.get(tool.name);
        expect(row, `${tool.name} is missing from the README`).toBeDefined();
        expect(row?.roster, tool.name).toBe(roster);
        expect(MARK_WORDS.get(row?.marks ?? ""), `${tool.name}'s marks "${row?.marks}"`).toContainEqual(tool.annotations);
      }
    }
    expect([...rows.keys()].sort()).toEqual([...seen].sort());
    const readme = readFileSync(new URL("../../README.md", import.meta.url), "utf8");
    expect(readme).toContain(`## Tools (${seen.size})`);
  });

  it("the destructive tools are exactly the deletes and the cancel", async () => {
    const { tools } = await listed("full");
    expect(tools.filter((t) => t.annotations?.destructiveHint === true).map((t) => t.name).sort()).toEqual([
      "cancel_run",
      "delete_agent",
      "delete_skill",
    ]);
  });
});

describe("instructions", () => {
  it("the full roster sends them: the docs method and the rules", async () => {
    const { instructions } = await listed("full");
    expect(instructions).toBe(SERVER_INSTRUCTIONS);
    expect(SERVER_INSTRUCTIONS).toContain(AGENT_RULES);
    expect(SERVER_INSTRUCTIONS).toContain("search_docs, then read_doc the page whole");
    // Skills reach an agent only when it loads them; the instructions always arrive (stigmer#3333).
    expect(SERVER_INSTRUCTIONS).toContain("If Stigmer's skills are installed, load the one for the job before answering.");
  });

  it("stay under 2,000 characters, since every session's prompt carries them", () => {
    expect(SERVER_INSTRUCTIONS.length).toBeLessThan(2000);
  });

  it.each(["channels", "conversation", "memory"])("the %s roster sends none", async (roster) => {
    expect((await listed(roster)).instructions).toBeUndefined();
  });
});
