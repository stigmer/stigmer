// MCP server resource template (stigmer://mcp-servers/{org}/{slug}).
// Go parity: mcp-server/internal/domains/mcpservers/resources.go.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { BackendTarget } from "../client";
import { registerResource } from "../resourcehandler";
import { fetchMcpServer } from "./fetch";

/** Register the MCP server resource template; returns the registered resource names. */
export function registerMcpServerResources(server: McpServer, target: BackendTarget): string[] {
  registerResource(server, target, {
    name: "stigmer_mcp_server",
    title: "Stigmer MCP Server",
    description: "Full definition of a Stigmer MCP server, identified by organization and slug.",
    template: "stigmer://mcp-servers/{org}/{slug}",
    fetch: fetchMcpServer,
  });
  return ["stigmer_mcp_server"];
}
