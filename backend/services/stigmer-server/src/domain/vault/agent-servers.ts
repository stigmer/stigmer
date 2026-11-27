/**
 * An MCP server written in an agent, read as the plugin server entry every
 * planner already reads (`McpServerEntry`): an HTTP server at its URL with
 * its headers, and `env` naming every run value its headers read. One
 * shape, so the values planning, the values fetch and the login check
 * treat a server the same whether a plugin or an agent holds it.
 *
 * The `${NAME}` scan is the plugin library's (`PLACEHOLDER_PATTERN`, the
 * runner's own scanner, pinned equal by a runner test), so a name planned
 * here is the name the runner fills.
 *
 * Sign-in. The agent's save asks each of its servers that says nothing
 * about authentication whether it wants a sign-in, with the probe a
 * plugin's install asks (domain/mcp/sign-in-probe.ts), and records the
 * answers on the agent's status (`AgentStatus.server_sign_ins`). Handed
 * those answers, a server whose answer at its own address asked for a
 * sign-in is completed exactly as install completes a plugin's server, so
 * the resolver's one login rule reads it: a required login at its address,
 * refused with "sign in to …" until there is one. An answer recorded at
 * another address is ignored (the next save asks again), and a server
 * with no such answer keeps the optional login the resolver gives it.
 *
 * Proven by __tests__/agent-servers.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import { PLACEHOLDER_PATTERN } from "@stigmer/plugin-package";
import { accessTokenVariable } from "@stigmer/tool-vocabulary";

import type { AgentMcpServer } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import type { AgentServerSignIn } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/status_pb";
import { McpServerEntrySchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import type { McpServerEntry } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";

import { authorShapeUrl, completeSignIn } from "../mcp/sign-in-probe.js";

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

/** Whether one of `answers`, recorded for `server` at its own address, asked for a sign-in. */
export function asksSignIn(server: Pick<AgentMcpServer, "name" | "url">, answers: readonly AgentServerSignIn[]): boolean {
  return answers.some((answer) => answer.name === server.name && answer.url === server.url && answer.signIn !== undefined);
}

/**
 * `server` as a plugin server entry: HTTP, its URL and headers, the run
 * values its headers read; completed with its sign-in when `answers` (the
 * agent's `status.server_sign_ins`) say its address asked for one.
 */
export function agentServerEntry(server: AgentMcpServer, answers: readonly AgentServerSignIn[] = []): McpServerEntry {
  const entry = create(McpServerEntrySchema, {
    name: server.name,
    transport: { case: "http", value: { url: server.url, headers: { ...server.headers } } },
    env: headerReferences(server.headers),
  });
  if (authorShapeUrl(entry) === undefined || !asksSignIn(server, answers)) {
    return entry;
  }
  return completeSignIn(entry, accessTokenVariable(server.name));
}
