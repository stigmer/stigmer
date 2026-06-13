// Agent resource template (stigmer://agents/{org}/{slug}).
// Go parity: mcp-server/internal/domains/agents/resources.go.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { BackendTarget } from "../client.js";
import { registerResource } from "../resourcehandler.js";
import { fetchAgent } from "./fetch.js";

/** Register the agent resource template; returns the registered resource names. */
export function registerAgentResources(server: McpServer, target: BackendTarget): string[] {
  registerResource(server, target, {
    name: "stigmer_agent",
    title: "Stigmer Agent",
    description: "Full definition of a Stigmer agent, identified by organization and slug.",
    template: "stigmer://agents/{org}/{slug}",
    fetch: fetchAgent,
  });
  return ["stigmer_agent"];
}
