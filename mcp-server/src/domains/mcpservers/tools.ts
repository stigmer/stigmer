// MCP tools for the McpServer domain.
// Go parity: mcp-server/internal/domains/mcpservers/tools.go.
//
// Tool name, description, and per-field input descriptions are part of the
// parity contract (clients surface them to the model verbatim).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { McpServerInputShape } from "../../gen/mcpserver.js";
import { resolveToken, type BackendTarget } from "../client.js";
import { textOrError } from "../toolresult.js";
import { applyMcpServer } from "./apply.js";
import { deleteMcpServer } from "./delete.js";
import { fetchMcpServer } from "./fetch.js";

/** Register every McpServer-domain tool; returns the registered tool names. */
export function registerMcpServerTools(server: McpServer, target: BackendTarget): string[] {
  server.registerTool(
    "get_mcp_server",
    {
      description:
        "Get full details of a Stigmer MCP server by its org and slug (e.g. org=acme slug=my-server).",
      inputSchema: {
        org: z.string().describe("Organization slug that owns the MCP server (e.g. acme)."),
        slug: z
          .string()
          .describe("MCP server slug — the unique identifier within the org (e.g. my-server)."),
      },
    },
    (args, extra) =>
      textOrError(() =>
        fetchMcpServer(target.serverAddress, resolveToken(extra, target.apiKey), args.org, args.slug),
      ),
  );

  server.registerTool(
    "apply_mcp_server",
    {
      description:
        "Create or update a Stigmer MCP server definition (idempotent). Provide identity fields (name, org) and server configuration (stdio/http, tools, env, etc.).",
      inputSchema: McpServerInputShape,
    },
    (args, extra) =>
      textOrError(() =>
        applyMcpServer(target.serverAddress, resolveToken(extra, target.apiKey), args),
      ),
  );

  server.registerTool(
    "delete_mcp_server",
    {
      description:
        "Delete a Stigmer MCP server definition by its org and slug. Returns the deleted MCP server.",
      inputSchema: {
        org: z.string().describe("Organization slug that owns the MCP server (e.g. acme)."),
        slug: z
          .string()
          .describe("MCP server slug — the unique identifier within the org (e.g. github)."),
      },
    },
    (args, extra) =>
      textOrError(() =>
        deleteMcpServer(
          target.serverAddress,
          resolveToken(extra, target.apiKey),
          args.org,
          args.slug,
        ),
      ),
  );

  return ["get_mcp_server", "apply_mcp_server", "delete_mcp_server"];
}
