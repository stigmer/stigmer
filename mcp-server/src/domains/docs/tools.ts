// The docs tools: search_docs and read_doc, for an agent with these tools but
// no shell. They are the CLI's `stigmer docs search` and `stigmer docs read`,
// over the same reader (reader.ts), and answer the same way: the matching
// pages, then a page's Markdown export whole, opening with its Source URL so
// the agent can cite it. Full roster only; they read the public docs and need
// no sign-in.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { READ_OPEN_WORLD } from "../toolmarks.js";
import { textOrError } from "../toolresult.js";
import { formatHits, sharedDocsReader, type DocsReader } from "./reader.js";

/** Register the docs tools; returns the registered tool names. */
export function registerDocsTools(server: McpServer, reader: DocsReader = sharedDocsReader()): string[] {
  server.registerTool(
    "search_docs",
    {
      annotations: READ_OPEN_WORLD,
      description:
        "Search Stigmer's documentation at stigmer.ai/docs for the pages that answer a question: " +
        "what Stigmer is, its editions and billing, how a concept works, a CLI command or SDK call, " +
        "or why something fails. Returns the best-matching pages with their URLs. Then read the " +
        "page with read_doc, whole, and answer from what it says.",
      inputSchema: {
        query: z.string().min(1).describe("A few words naming what the question is about (e.g. 'runner port', 'editions billing')."),
      },
    },
    (args) => textOrError(async () => formatHits(args.query, await reader.searchDocs(args.query))),
  );

  server.registerTool(
    "read_doc",
    {
      annotations: READ_OPEN_WORLD,
      description:
        "Read one page of Stigmer's documentation whole, as Markdown, exactly as published today. " +
        "The text opens with the page's Source URL: cite it in the answer. Pass the page's path " +
        "(e.g. concepts/tools) or its full https://stigmer.ai/docs/... URL. Only stigmer.ai/docs is read.",
      inputSchema: {
        page: z.string().min(1).describe("The page's path after /docs/ (e.g. concepts/tools), or its full URL."),
      },
    },
    (args) => textOrError(async () => (await reader.readDocPage(args.page)).markdown),
  );

  return ["search_docs", "read_doc"];
}
