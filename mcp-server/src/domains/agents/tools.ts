// MCP tools for the Agent domain. Mirrors Go internal/domains/agents/tools.go.
//
// The tool name, description, and per-field input descriptions are part of the
// parity contract (MCP clients surface them to the model verbatim), so they are
// copied exactly from the Go definitions. This file is the canonical pattern the
// remaining domains follow in T02: define the tool, resolve the per-request
// credential, delegate to the domain fetch, and shape the result.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { AgentInputShape } from "../../gen/agent.js";
import { resolveToken, type BackendTarget } from "../client.js";
import { textOrError } from "../toolresult.js";
import { applyAgent } from "./apply.js";
import { deleteAgent } from "./delete.js";
import { fetchAgent } from "./fetch.js";

/** Register every Agent-domain tool; returns the registered tool names. */
export function registerAgentTools(server: McpServer, target: BackendTarget): string[] {
  server.registerTool(
    "get_agent",
    {
      description:
        "Get full details of a Stigmer agent by its org and slug (e.g. org=stigmer slug=code-reviewer).",
      inputSchema: {
        org: z.string().describe("Organization slug that owns the agent (e.g. stigmer)."),
        slug: z
          .string()
          .describe("Agent slug — the unique identifier within the org (e.g. code-reviewer)."),
      },
    },
    (args, extra) =>
      textOrError(() =>
        fetchAgent(target.serverAddress, resolveToken(extra, target.apiKey), args.org, args.slug),
      ),
  );

  server.registerTool(
    "apply_agent",
    {
      description:
        "Create or update a Stigmer agent (idempotent). Provide identity fields (name, org) and agent configuration (instructions, skills, MCP servers, etc.).",
      inputSchema: AgentInputShape,
    },
    (args, extra) =>
      textOrError(() => applyAgent(target.serverAddress, resolveToken(extra, target.apiKey), args)),
  );

  server.registerTool(
    "delete_agent",
    {
      description: "Delete a Stigmer agent by its org and slug. Returns the deleted agent.",
      inputSchema: {
        org: z.string().describe("Organization slug that owns the agent (e.g. stigmer)."),
        slug: z
          .string()
          .describe("Agent slug — the unique identifier within the org (e.g. code-reviewer)."),
      },
    },
    (args, extra) =>
      textOrError(() =>
        deleteAgent(target.serverAddress, resolveToken(extra, target.apiKey), args.org, args.slug),
      ),
  );

  return ["get_agent", "apply_agent", "delete_agent"];
}
