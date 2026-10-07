// MCP tools for the Credential domain. A credential holds the keys a person
// or the organization saves for agents, MCP servers and git hosts; these
// tools let an assistant see which credentials exist and what each field is
// for, and remove one.
//
// The secret contract every description teaches: reads return secret values
// redacted to ***REDACTED*** (server-enforced), and no tool here writes or
// reveals a value. A value passed through an MCP tool call has already been
// in the model's context, so saving one is left to the person.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveToken, type BackendTarget } from "../client.js";
import { textOrError } from "../toolresult.js";
import { deleteCredential } from "./delete.js";
import { fetchCredential } from "./fetch.js";

const credentialAddress = {
  org: z
    .string()
    .default("")
    .describe(
      "Organization slug the credential is written in (e.g. acme). Leave empty on a server that holds one organization.",
    ),
  slug: z
    .string()
    .describe("Credential slug — the unique identifier within the org (e.g. github-token)."),
};

/** Register every Credential-domain tool; returns the registered tool names. */
export function registerCredentialTools(server: McpServer, target: BackendTarget): string[] {
  server.registerTool(
    "get_credential",
    {
      description:
        "Get full details of a Stigmer credential by its org and slug: whom it belongs to, its " +
        "fields and what they serve. Secret values are redacted to ***REDACTED*** — they can " +
        "never be read back through this tool.",
      inputSchema: credentialAddress,
    },
    (args, extra) =>
      textOrError(() =>
        fetchCredential(target.serverAddress, resolveToken(extra, target.apiKey), args.org, args.slug),
      ),
  );

  server.registerTool(
    "delete_credential",
    {
      description:
        "Delete a Stigmer credential by its org and slug. Returns the deleted credential. " +
        "Runs that relied on it will no longer receive its values.",
      inputSchema: credentialAddress,
    },
    (args, extra) =>
      textOrError(() =>
        deleteCredential(target.serverAddress, resolveToken(extra, target.apiKey), args.org, args.slug),
      ),
  );

  return ["get_credential", "delete_credential"];
}
