/**
 * MCP connection manager for the deep agent execution path.
 *
 * Wraps @langchain/mcp-adapters MultiServerMCPClient with:
 * - Conversion from ResolvedMcpServer[] to the SDK's Connection config
 * - Proper async cleanup via close()
 * - Input-schema sanitization of unicode-invalid regex patterns
 *   (issue #420; semantics in shared/mcp-schema-sanitizer.ts) — a vendor
 *   pattern that cannot compile under the /u flag must not leave its tool
 *   permanently uncallable
 * - Tool filtering by each server's effective enabled_tools allow-list
 *   (issue #350; semantics in shared/mcp-enabled-tools.ts) — the model only
 *   ever sees the tools the agent's manifest enables
 *
 * Transport policy (stdio is local-runner-only) is enforced upstream at
 * resolution time by shared/mcp-transport-guard.ts — servers reaching
 * this manager have already passed it.
 *
 * Stdio env contract (oss#256): a subprocess receives exactly the
 * variables declared in the server's spec.env (resolved upstream by
 * filterEnvToDeclaredKeys) plus the MCP SDK's minimal base environment
 * (HOME, LOGNAME, PATH, SHELL, TERM, USER — getDefaultEnvironment in
 * @modelcontextprotocol/sdk, merged under whatever we pass). The
 * runner's own process env is never passed: it carries runner-internal
 * credentials (enumerated in runner-credential-keys.ts) that no
 * third-party MCP subprocess may see. A declared-empty env and an
 * undeclared env are deliberately equivalent — both yield the SDK base
 * environment.
 *
 * The Cursor execution path does NOT use this manager — it passes MCP
 * configs directly to the Cursor SDK via toCursorMcpConfig(). This
 * manager serves LangGraph-based deep agent executions, and discovery
 * (activities/discover-mcp-server.ts) builds its spawn config through
 * toMcpClientConfig too.
 */

import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { Connection } from "@langchain/mcp-adapters";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import type { ResolvedMcpServer } from "./mcp-resolver.js";
import { filterToolsByEnabledTools } from "./mcp-enabled-tools.js";
import { sanitizeSchemaPatterns } from "./mcp-schema-sanitizer.js";

/**
 * Convert harness-agnostic ResolvedMcpServer[] into the
 * MultiServerMCPClient connection config format.
 */
export function toMcpClientConfig(
  servers: ResolvedMcpServer[],
): Record<string, Connection> {
  const config: Record<string, Connection> = {};

  for (const server of servers) {
    if (server.connectionType === "stdio") {
      if (!server.command) continue;
      if (!server.env || Object.keys(server.env).length === 0) {
        console.log(
          `[MCP] Server '${server.slug}' declares no env — its subprocess ` +
          `starts with the minimal base environment only. Declare variables ` +
          `in the McpServer's spec.env to pass them.`,
        );
      }
      config[server.slug] = {
        transport: "stdio",
        command: server.command,
        args: server.args ?? [],
        env: server.env,
        cwd: server.cwd,
      };
    } else if (server.connectionType === "http" || server.connectionType === "sse") {
      if (!server.url) continue;
      config[server.slug] = {
        transport: "http",
        url: server.url,
        headers: server.headers,
        // Re-establish severed connections (oss#316): when a remote MCP
        // server restarts mid-execution — the hosted bridge's sessions are
        // in-memory, so a deploy orphans every live one — the adapter's
        // onclose hook re-runs initialize, minting a fresh session for
        // subsequent calls instead of stranding the agent on a dead one.
        // Covers transport-close only; a session lost with no stream open
        // still surfaces as a JSON-RPC session-not-found on the next call.
        reconnect: { enabled: true, maxAttempts: 3, delayMs: 1_000 },
      };
    }
  }

  return config;
}

export interface McpConnectionResult {
  client: MultiServerMCPClient;
  tools: DynamicStructuredTool[];
  serverToolMap: Record<string, DynamicStructuredTool[]>;
}

/**
 * Create and initialize MCP connections from resolved server specs.
 *
 * The caller is responsible for calling result.client.close() when
 * done — typically in a finally block or via a cleanup handler.
 */
export async function connectMcpServers(
  servers: ResolvedMcpServer[],
): Promise<McpConnectionResult> {
  const connectionConfig = toMcpClientConfig(servers);

  if (Object.keys(connectionConfig).length === 0) {
    const client = new MultiServerMCPClient({});
    return { client, tools: [], serverToolMap: {} };
  }

  const client = new MultiServerMCPClient(connectionConfig);
  const discoveredToolMap = await client.initializeConnections();

  // Drop unicode-invalid regex patterns from every discovered tool's input
  // schema BEFORE anything downstream holds a reference (issue #420):
  // @langchain/core re-validates against tool.schema on every invocation,
  // so one vendor pattern that cannot compile under the /u flag would
  // otherwise make its tool permanently uncallable. Semantics and the
  // loosen-never-tighten invariant live in shared/mcp-schema-sanitizer.ts.
  for (const [slug, discovered] of Object.entries(discoveredToolMap)) {
    for (const tool of discovered) {
      const droppedPatterns = sanitizeSchemaPatterns(tool.schema);
      if (droppedPatterns.length > 0) {
        console.warn(
          `[MCP] Server '${slug}' tool '${tool.name}': dropped ` +
          `${droppedPatterns.length} regex pattern(s) that cannot compile ` +
          `under the unicode flag — the tool stays callable, the server ` +
          `still validates its own inputs (issue #420): ` +
          droppedPatterns
            .map((d) =>
              `${d.location} ${JSON.stringify(d.pattern)}` +
              (d.compilesWithoutUnicodeFlag ? "" : " (invalid without /u too)"),
            )
            .join(", "),
        );
      }
    }
  }

  // Enforce each server's effective enabled_tools allow-list (issue #350)
  // HERE, before anything downstream sees the tools: the parent tool list,
  // the approval gate's toolServerMap, and the sub-agent McpAccess filter
  // (whose subset-of-parent check is only real against a narrowed map) all
  // derive from this result. Servers without a restriction (enabledTools
  // absent — including synthesized attachments) pass through untouched.
  const enabledBySlug = new Map(
    servers.map((s) => [s.slug, s.enabledTools]),
  );
  const serverToolMap: Record<string, DynamicStructuredTool[]> = {};
  const tools: DynamicStructuredTool[] = [];
  for (const [slug, discovered] of Object.entries(discoveredToolMap)) {
    const filtered = filterToolsByEnabledTools(
      slug, discovered, enabledBySlug.get(slug),
    );
    serverToolMap[slug] = filtered;
    tools.push(...filtered);
  }

  console.log(
    `[MCP] Connected ${Object.keys(serverToolMap).length} server(s), ` +
    `${tools.length} tool(s) total: ${Object.entries(serverToolMap)
      .map(([name, t]) => `${name}(${t.length})`)
      .join(", ")}`,
  );

  return { client, tools, serverToolMap };
}
