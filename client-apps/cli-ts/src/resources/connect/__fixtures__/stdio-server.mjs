// Minimal stdio MCP server fixture for `connect --dry-run` discovery tests.
//
// Spawned as a subprocess by discover.ts via StdioClientTransport. Advertises a
// single tool and a single resource template using the low-level Server API
// (the most version-stable surface of @modelcontextprotocol/sdk). It also echoes
// an --env-provided value through the tool description so tests can assert env
// propagation when needed.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const server = new Server(
  { name: "fixture-mcp", version: "0.0.1" },
  { capabilities: { tools: {}, resources: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "echo",
      description: `echo a message (token=${process.env.FIXTURE_TOKEN ?? "unset"})`,
      inputSchema: { type: "object", properties: { text: { type: "string" } } },
    },
    { name: "noop", description: "", inputSchema: { type: "object" } },
  ],
}));

server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({
  resourceTemplates: [
    {
      uriTemplate: "file:///{path}",
      name: "local-file",
      description: "a local file",
      mimeType: "text/plain",
    },
  ],
}));

await server.connect(new StdioServerTransport());
