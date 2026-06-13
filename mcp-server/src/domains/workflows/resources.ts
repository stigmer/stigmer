// Workflow resource template (stigmer://workflows/{org}/{slug}).
// Go parity: mcp-server/internal/domains/workflows/resources.go.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { BackendTarget } from "../client.js";
import { registerResource } from "../resourcehandler.js";
import { fetchWorkflow } from "./fetch.js";

/** Register the workflow resource template; returns the registered resource names. */
export function registerWorkflowResources(server: McpServer, target: BackendTarget): string[] {
  registerResource(server, target, {
    name: "stigmer_workflow",
    title: "Stigmer Workflow",
    description: "Full definition of a Stigmer workflow, identified by organization and slug.",
    template: "stigmer://workflows/{org}/{slug}",
    fetch: fetchWorkflow,
  });
  return ["stigmer_workflow"];
}
