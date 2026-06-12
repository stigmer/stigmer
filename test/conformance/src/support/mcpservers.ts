// Canonical valid McpServer fixtures for the conformance suite.
// Domain: conformance support.
//
// McpServer is a flat (non-versioned) blueprint whose spec carries a required
// `server_type` oneof. These builders give the suite one canonical *valid* MCP
// server — a stdio subprocess server, the most common kind — so CRUD and
// cross-resource tests share a single source of truth and vary it deliberately.
//
// Negative cases (missing server_type, empty command, malformed URL) are written
// inline in the suite, not here: this module represents validity by construction,
// matching the convention established by support/workflows.ts.
import type { MessageInitShape } from "@bufbuild/protobuf";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";

export const MCPSERVER_API_VERSION = "agentic.stigmer.ai/v1";
export const MCPSERVER_KIND = "McpServer";

export interface McpServerSpecOptions {
  // Human-readable description; defaults to a stable placeholder.
  description?: string;
  // stdio command to launch; defaults to a real reference MCP server invocation.
  command?: string;
  // Arguments passed to the command.
  args?: string[];
}

// A valid McpServerSpec: a stdio server configuration satisfying the
// `server_type` oneof (required) and `stdio.command` (required, min_len=1).
export function makeMcpServerSpec(
  opts: McpServerSpecOptions = {},
): MessageInitShape<typeof McpServerSpecSchema> {
  return {
    description: opts.description ?? "conformance fixture",
    serverType: {
      case: "stdio",
      value: {
        command: opts.command ?? "npx",
        args: opts.args ?? ["-y", "@modelcontextprotocol/server-everything"],
      },
    },
  };
}

export interface McpServerOptions extends McpServerSpecOptions {
  org: string;
  name: string;
}

// A complete, valid McpServer resource ready to hand to create/apply/update.
export function makeMcpServer(opts: McpServerOptions): MessageInitShape<typeof McpServerSchema> {
  const { org, name, description, command, args } = opts;
  return {
    apiVersion: MCPSERVER_API_VERSION,
    kind: MCPSERVER_KIND,
    metadata: { name, org },
    spec: makeMcpServerSpec({ description, command, args }),
  };
}
