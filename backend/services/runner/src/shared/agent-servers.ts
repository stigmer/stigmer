/**
 * An MCP server an agent writes itself, read as the plugin server entry the
 * resolver already reads (`McpServerEntry`): an HTTP server at its URL with
 * its headers, `env` naming every run value its headers read.
 *
 * Its login: a server whose headers send no Authorization of their own
 * takes `Authorization: Bearer ${<NAME>_ACCESS_TOKEN}` when, and only when,
 * the run's values for it hold that key (the server plans it as an optional
 * login, found by the server's address). A server with no such value is
 * called with no login, rather than refused by the strict placeholder
 * resolver for a header it never asked for.
 *
 * The `${NAME}` scan is this runner's own (`PLACEHOLDER_RE`), which the
 * server's save step and planner read too (pinned equal by
 * __tests__/plugin-servers.test.ts); the login variable's name is the one
 * the server plans (`@stigmer/tool-vocabulary`).
 *
 * Proven by __tests__/agent-servers.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import type { AgentMcpServer } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { McpServerEntrySchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import type { McpServerEntry } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import { accessTokenVariable } from "@stigmer/tool-vocabulary";

import { PLACEHOLDER_RE } from "./placeholder-resolver.js";

/** `server` as a plugin server entry, with its login header when `values` holds its login. */
export function agentServerEntry(
  server: AgentMcpServer,
  values: Readonly<Record<string, string>> | undefined,
): McpServerEntry {
  const headers: Record<string, string> = { ...server.headers };
  const login = accessTokenVariable(server.name);
  const sendsAuthorization = Object.keys(headers).some((header) => header.toLowerCase() === "authorization");
  if (!sendsAuthorization && values !== undefined && login in values) {
    headers["Authorization"] = `Bearer \${${login}}`;
  }
  const env = new Set<string>();
  for (const value of Object.values(headers)) {
    for (const match of value.matchAll(PLACEHOLDER_RE)) {
      const name = match[1];
      if (name !== undefined) env.add(name);
    }
  }
  return create(McpServerEntrySchema, {
    name: server.name,
    transport: { case: "http", value: { url: server.url, headers } },
    env: [...env].sort(),
  });
}
