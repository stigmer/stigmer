// The docs tools through an in-memory MCP client, over a fake reader: the
// search answers with numbered pages, a read answers with the page whole, and
// a reader's refusal comes back as an isError result carrying its words, and
// an argument a tool doesn't declare is refused by name, as on every other
// tool (src/domains/__tests__/unknown-arguments.test.ts, which can't hold
// these: their valid call would read the live site).

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";

import { DocsError, type DocsReader } from "../reader";
import { registerDocsTools } from "../tools";

const reader: DocsReader = {
  async searchDocs(query) {
    return query === "none" ? [] : [{ title: "Runners", url: "https://stigmer.ai/docs/runners", description: "Where a run executes." }];
  },
  async readDocPage(page) {
    if (page.startsWith("http://")) throw new DocsError("refused", `Only pages under https://stigmer.ai/docs are read; "${page}" is not one.`);
    return { url: `https://stigmer.ai/docs/${page}`, markdown: `Source: https://stigmer.ai/docs/${page}\n\nWhole page.\n` };
  },
};

async function call(name: string, args: Record<string, string>) {
  const server = new McpServer({ name: "docs", version: "test" });
  expect(registerDocsTools(server, reader)).toEqual(["search_docs", "read_doc"]);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "docs", version: "test" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const result = (await client.callTool({ name, arguments: args })) as { content: Array<{ text?: string }>; isError?: boolean };
  await client.close();
  return { text: result.content[0]?.text ?? "", isError: result.isError === true };
}

describe("the docs tools", () => {
  it("search_docs answers with the matching pages", async () => {
    expect(await call("search_docs", { query: "runner" })).toEqual({
      text: "1. Runners: https://stigmer.ai/docs/runners\n   Where a run executes.",
      isError: false,
    });
    expect((await call("search_docs", { query: "none" })).text).toContain('No docs page matches "none"');
  });

  it("read_doc answers with the page whole", async () => {
    expect(await call("read_doc", { page: "runners" })).toEqual({
      text: "Source: https://stigmer.ai/docs/runners\n\nWhole page.\n",
      isError: false,
    });
  });

  it.each([
    ["search_docs", { query: "runner" }],
    ["read_doc", { page: "runners" }],
  ])("%s refuses an undeclared argument and names it", async (name, args) => {
    const refused = await call(name, { ...args, sluggg: "typo" });
    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/-32602: Input validation error/);
    expect(refused.text).toContain("sluggg");
  });

  it("read_doc returns a refusal as an error result", async () => {
    const result = await call("read_doc", { page: "http://evil.example" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("Only pages under https://stigmer.ai/docs are read");
  });
});
