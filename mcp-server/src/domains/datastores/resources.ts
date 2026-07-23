// Datastore resource template (stigmer://datastores/{org}/{slug}).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { BackendTarget } from "../client.js";
import { registerResource } from "../resourcehandler.js";
import { fetchDatastore } from "./fetch.js";

/** Register the datastore resource template; returns the registered resource names. */
export function registerDatastoreResources(server: McpServer, target: BackendTarget): string[] {
  registerResource(server, target, {
    name: "stigmer_datastore",
    title: "Stigmer Datastore",
    description:
      "Full definition of a Stigmer datastore (collections, constraints, grants), " +
      "identified by organization and slug.",
    template: "stigmer://datastores/{org}/{slug}",
    fetch: fetchDatastore,
  });
  return ["stigmer_datastore"];
}
