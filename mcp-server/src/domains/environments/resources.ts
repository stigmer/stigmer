// Environment resource template (stigmer://environments/{org}/{slug}).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { BackendTarget } from "../client.js";
import { registerResource } from "../resourcehandler.js";
import { fetchEnvironment } from "./fetch.js";

/** Register the environment resource template; returns the registered resource names. */
export function registerEnvironmentResources(server: McpServer, target: BackendTarget): string[] {
  registerResource(server, target, {
    name: "stigmer_environment",
    title: "Stigmer Environment",
    description:
      "Full definition of a Stigmer environment, identified by organization and slug. " +
      "Secret values are redacted.",
    template: "stigmer://environments/{org}/{slug}",
    fetch: fetchEnvironment,
  });
  return ["stigmer_environment"];
}
