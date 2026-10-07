// Credential resource template (stigmer://credentials/{org}/{slug}).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { BackendTarget } from "../client.js";
import { registerResource } from "../resourcehandler.js";
import { fetchCredential } from "./fetch.js";

/** Register the credential resource template; returns the registered resource names. */
export function registerCredentialResources(server: McpServer, target: BackendTarget): string[] {
  registerResource(server, target, {
    name: "stigmer_credential",
    title: "Stigmer Credential",
    description:
      "Full definition of a Stigmer credential, identified by organization and slug. " +
      "Secret values are redacted.",
    template: "stigmer://credentials/{org}/{slug}",
    fetch: fetchCredential,
  });
  return ["stigmer_credential"];
}
