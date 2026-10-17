/**
 * An MCP server written in an agent, read as the plugin server entry every
 * planner already reads (`McpServerEntry`): an HTTP server at its URL with
 * its headers, and `env` naming every run value its headers read. One
 * shape, so the values planning, the values fetch and the login check
 * treat a server the same whether a plugin or an agent holds it.
 *
 * The `${NAME}` scan is the plugin library's (`PLACEHOLDER_PATTERN`, the
 * runner's own scanner, pinned equal by a runner test), so a name planned
 * here is the name the runner fills. A server written in an agent has no
 * sign-in record: install's probe never ran for it, and its login is found
 * by its address when a run is planned instead.
 *
 * Proven by __tests__/agent-servers.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import { PLACEHOLDER_PATTERN } from "@stigmer/plugin-package";

import type { AgentMcpServer } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { McpServerEntrySchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import type { McpServerEntry } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";

/** The names a server's header values read, sorted, each once. */
function headerReferences(headers: Readonly<Record<string, string>>): string[] {
  const names = new Set<string>();
  for (const value of Object.values(headers)) {
    for (const match of value.matchAll(PLACEHOLDER_PATTERN)) {
      const name = match[1];
      if (name !== undefined) names.add(name);
    }
  }
  return [...names].sort();
}

/** `server` as a plugin server entry: HTTP, its URL and headers, the run values its headers read. */
export function agentServerEntry(server: AgentMcpServer): McpServerEntry {
  return create(McpServerEntrySchema, {
    name: server.name,
    transport: { case: "http", value: { url: server.url, headers: { ...server.headers } } },
    env: headerReferences(server.headers),
  });
}
