// MCP tools for the Agent domain. Mirrors Go internal/domains/agents/tools.go.
//
// The tool name, description, and per-field input descriptions are part of the
// parity contract (MCP clients surface them to the model verbatim), so they are
// copied exactly from the Go definitions. This file is the canonical pattern the
// remaining domains follow in T02: define the tool, resolve the per-request
// credential, delegate to the domain fetch, and shape the result.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { resolveToken, type BackendTarget } from "../client";
import { textOrError } from "../toolresult";
import { fetchAgent } from "./fetch";

/** Register every Agent-domain tool on the server. */
export function registerAgentTools(server: McpServer, target: BackendTarget): void {
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
}
