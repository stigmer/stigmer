/**
 * Lists the tools an MCP server offers now, with the one mark the approval
 * default reads: whether the tool's own MCP annotation says
 * `destructiveHint: true`. Nothing is stored; every listing asks the server.
 *
 * Two readers: a tools listing a person asks for from a plugin's page
 * (activities/list-plugin-tools.ts, the connect workflow's one step), and
 * the start of a turn on an engine that does not bind the tools itself (the
 * Cursor engine's tools are loaded by its SDK, not by this runner), whose
 * approval default needs the marks before the turn runs
 * ({@link listTurnTools}). The native engine reads the same marks from the
 * tools it loads, so it never lists twice.
 *
 * Annotations are untrusted (the MCP spec says so), so they are read only in
 * the direction that adds a question: `readOnlyHint` is never read, and a
 * tool marked both read-only and destructive asks. MCP's own default for an
 * unannotated tool is "destructive"; Stigmer acts only on an explicit true,
 * so a server that annotates nothing gates nothing. A server whose listing
 * fails asks before every one of its tools (`McpToolListing.unlisted`): an
 * unread mark never means "ask nothing".
 *
 * Bounds (issue #239): a remote endpoint that accepts a connection but never
 * completes the handshake would otherwise hang forever, so HTTP servers get
 * a short init bound and stdio servers a generous one, because a first run
 * may compile or install packages (issue #243). A local program is started
 * as the agent user on a separating runner (`stdioAsAgent`): its command is
 * the plugin's, and must never run with the runner's rights.
 */

import { MultiServerMCPClient, type Connection } from "@langchain/mcp-adapters";

import { agentIdentity, setprivArgs, type AgentIdentity } from "./agent-identity.js";
import type { ResolvedMcpServer } from "./mcp-resolver.js";
import { toMcpClientConfig } from "./mcp-manager.js";
import { detectOAuthChallenge } from "./mcp-oauth-detect.js";
import { withTimeout } from "./with-timeout.js";

const HTTP_INIT_TIMEOUT_MS = 30_000;
const STDIO_INIT_TIMEOUT_MS = 270_000;

/** One tool a server lists. */
export interface ListedTool {
  readonly name: string;
  readonly description: string;
  /** The tool's MCP annotation `destructiveHint === true`, and nothing else. */
  readonly destructive: boolean;
}

/** What a turn's listing found: each listed server's tool names, each destructive tool, and the servers whose listing failed. */
export interface McpToolListing {
  readonly listed: readonly { readonly server: string; readonly tools: readonly string[] }[];
  readonly destructive: readonly { readonly server: string; readonly tool: string }[];
  readonly unlisted: readonly string[];
}

/** The session-init bound for a server's transport. */
export function initTimeoutMsFor(connectionType: ResolvedMcpServer["connectionType"]): number {
  return connectionType === "stdio" ? STDIO_INIT_TIMEOUT_MS : HTTP_INIT_TIMEOUT_MS;
}

/**
 * The user-facing message for a session-init timeout. Names the endpoint (or
 * command) so the failure is diagnosable from the message alone, and explains
 * the known silent-hang shape for HTTP endpoints — issue #239's mechanism.
 */
export function initTimeoutMessageFor(slug: string, resolved: ResolvedMcpServer): string {
  const seconds = Math.round(initTimeoutMsFor(resolved.connectionType) / 1000);
  if (resolved.connectionType === "stdio") {
    return (
      `MCP server '${slug}' (command: ${resolved.command}) did not complete ` +
      `MCP initialization within ${seconds}s. If this server requires ` +
      `compilation or package installation on first run (e.g. go run, npx), ` +
      `the cold start may have exceeded the listing's timeout.`
    );
  }
  return (
    `MCP server '${slug}' at ${resolved.url} did not complete MCP ` +
    `initialization within ${seconds}s. The endpoint accepted the connection ` +
    `but never finished the handshake — commonly an endpoint that rejects ` +
    `streamable HTTP while leaving its SSE fallback stream silently open. ` +
    `Verify the URL points at a live streamable-HTTP MCP endpoint.`
  );
}

/**
 * A stdio server's connection rewritten to start as the agent user through
 * `setpriv`, with the agent's home as `HOME`, on a separating runner
 * (`shared/agent-identity.ts`). An HTTP server, and every server on a runner
 * that does not separate, is unchanged.
 */
export function stdioAsAgent(config: Record<string, Connection>, identity: AgentIdentity | null = agentIdentity()): Record<string, Connection> {
  if (identity === null) return config;
  const out: Record<string, Connection> = {};
  for (const [slug, connection] of Object.entries(config)) {
    out[slug] =
      connection.transport === "stdio"
        ? {
            ...connection,
            command: "setpriv",
            args: [...setprivArgs(identity), "--", connection.command, ...(connection.args ?? [])],
            env: { ...connection.env, HOME: identity.home },
          }
        : connection;
  }
  return out;
}

/**
 * Connects to one resolved server and lists its tools. Throws the server's
 * failure; an HTTP server asking for a sign-in is re-probed once so the
 * failure says so instead of the MCP client's opaque aggregate.
 */
export async function listServerTools(server: ResolvedMcpServer): Promise<ListedTool[]> {
  const slug = server.slug;
  const connectionConfig = stdioAsAgent(toMcpClientConfig([server]));
  const client = new MultiServerMCPClient(connectionConfig);
  const tools: ListedTool[] = [];
  try {
    await withTimeout(
      initTimeoutMsFor(server.connectionType),
      () => initTimeoutMessageFor(slug, server),
      async () => {
        await client.initializeConnections();
        const mcpClient = await client.getClient(slug);
        if (!mcpClient) {
          throw new Error(`Failed to get MCP client for server '${slug}' after initialization`);
        }
        const listed = await mcpClient.listTools();
        for (const tool of listed.tools) {
          tools.push({
            name: tool.name,
            description: tool.description ?? "",
            destructive: tool.annotations?.destructiveHint === true,
          });
        }
      },
    );
  } catch (err) {
    const connection = connectionConfig[slug];
    if (connection !== undefined && connection.transport === "http" && connection.url) {
      const oauthError = await detectOAuthChallenge(connection.url, connection.headers, slug);
      if (oauthError) throw oauthError;
    }
    throw err;
  } finally {
    await client.close().catch((err: unknown) => {
      console.warn(`[mcp-tool-listing] Error closing MCP client for '${slug}': ${err instanceof Error ? err.message : err}`);
    });
  }
  return tools;
}

/**
 * Lists every plugin server of a turn in parallel, for an engine that does
 * not bind the tools itself. The platform's own servers are never listed:
 * none of their tools asks. A server whose listing fails is named in
 * `unlisted`, with the reason logged.
 */
export async function listTurnTools(
  servers: readonly ResolvedMcpServer[],
  list: (server: ResolvedMcpServer) => Promise<readonly ListedTool[]> = listServerTools,
): Promise<McpToolListing> {
  const listed = await Promise.all(
    servers
      .filter((server) => server.pluginOrigin !== null)
      .map(async (server) => {
        try {
          return { server: server.slug, tools: await list(server) };
        } catch (err) {
          console.warn(
            `[mcp-tool-listing] The tools of MCP server '${server.slug}' could not be listed, so every one of them asks first this turn: ` +
              `${err instanceof Error ? err.message : String(err)}`,
          );
          return { server: server.slug, tools: undefined };
        }
      }),
  );
  return {
    listed: listed.flatMap(({ server, tools }) =>
      tools === undefined ? [] : [{ server, tools: tools.map((tool) => tool.name) }],
    ),
    destructive: listed.flatMap(({ server, tools }) =>
      (tools ?? []).filter((tool) => tool.destructive).map((tool) => ({ server, tool: tool.name })),
    ),
    unlisted: listed.filter(({ tools }) => tools === undefined).map(({ server }) => server),
  };
}
