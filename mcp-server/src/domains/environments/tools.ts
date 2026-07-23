// MCP tools for the Environment domain. Environments hold the configuration
// and secrets that agents, workflows, and MCP servers resolve at runtime —
// without these tools, an assistant authoring an agent hits a dead end the
// moment env config is involved.
//
// The secret contract every description teaches: reads return secret values
// redacted to ***REDACTED*** (server-enforced); an apply that echoes the
// marker back preserves the existing secret, so get → edit → apply is always
// safe. Secret values are only ever sent when setting or rotating them, and
// they can never be read back through MCP.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { EnvironmentInputShape } from "../../gen/environment.js";
import { resolveToken, type BackendTarget } from "../client.js";
import { textOrError } from "../toolresult.js";
import { applyEnvironment } from "./apply.js";
import { deleteEnvironment } from "./delete.js";
import { fetchEnvironment } from "./fetch.js";

/** Register every Environment-domain tool; returns the registered tool names. */
export function registerEnvironmentTools(server: McpServer, target: BackendTarget): string[] {
  server.registerTool(
    "get_environment",
    {
      description:
        "Get full details of a Stigmer environment by its org and slug, including its variable " +
        "declarations. Secret values are redacted to ***REDACTED*** — they can never be read " +
        "back through this tool.",
      inputSchema: {
        org: z.string().describe("Organization slug that owns the environment (e.g. stigmer)."),
        slug: z
          .string()
          .describe("Environment slug — the unique identifier within the org (e.g. github-creds)."),
      },
    },
    (args, extra) =>
      textOrError(() =>
        fetchEnvironment(target.serverAddress, resolveToken(extra, target.apiKey), args.org, args.slug),
      ),
  );

  server.registerTool(
    "apply_environment",
    {
      description:
        "Create or update a Stigmer environment (idempotent). The spec is applied in full, so " +
        "include every variable the environment should keep. When updating, secret values read " +
        "back as ***REDACTED*** — echoing that marker preserves the existing secret, so a " +
        "get → edit → apply round-trip never destroys secrets; send a real value only to set " +
        "or rotate one.",
      inputSchema: EnvironmentInputShape,
    },
    (args, extra) =>
      textOrError(() =>
        applyEnvironment(target.serverAddress, resolveToken(extra, target.apiKey), args),
      ),
  );

  server.registerTool(
    "delete_environment",
    {
      description:
        "Delete a Stigmer environment by its org and slug. Returns the deleted environment. " +
        "Agents and workflows referencing it will fail to resolve their variables at run time.",
      inputSchema: {
        org: z.string().describe("Organization slug that owns the environment (e.g. stigmer)."),
        slug: z
          .string()
          .describe("Environment slug — the unique identifier within the org (e.g. github-creds)."),
      },
    },
    (args, extra) =>
      textOrError(() =>
        deleteEnvironment(target.serverAddress, resolveToken(extra, target.apiKey), args.org, args.slug),
      ),
  );

  return ["get_environment", "apply_environment", "delete_environment"];
}
