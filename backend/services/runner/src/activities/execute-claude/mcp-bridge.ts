/**
 * Every MCP server of a Claude turn, connected by the agent host and handed
 * to the engine in-process.
 *
 * The engine could start a stdio server itself and dial an HTTP one with its
 * headers, but either would undo what this harness keeps: the SDK puts an
 * external server's configuration, its login header included, on the
 * engine's command line, which every user of the machine can read, and a
 * stdio server it started would be its child, able to read its environment.
 * So the host connects each server exactly as the native engine does (the
 * shared connection config, `shared/mcp-manager.ts` `toMcpClientConfig`: a
 * stdio server's declared environment and nothing else, an HTTP server's
 * headers, reconnects), and the engine sees each one as an in-process server
 * under the same slug (`in-process-server.ts`) whose `tools/list` and
 * `tools/call` are forwarded unchanged. The platform's own servers (channel,
 * conversation, memory) ride the same bridge. Tool names stay Claude Code's,
 * `mcp__<slug>__<tool>`.
 *
 * What the bridge reads while it lists, once per turn:
 *  - every page of each server's tools, each schema loosened where a regex
 *    cannot compile under the unicode flag (`shared/mcp-schema-sanitizer.ts`),
 *    so one vendor pattern never leaves a tool uncallable;
 *  - each tool's own destructive mark, for the approval default
 *    (`shared/approval-policy.ts`), the platform's servers left out as on
 *    every engine;
 *  - the agent's tool lists: a tool out of scope is never listed to the
 *    engine, and a call to one is refused by the gate's closed world. The
 *    platform's servers are outside every list (`shared/tool-lists.ts`).
 *
 * Every connection is closed when the turn ends (`turn.ts`).
 */

import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { toMcpClientConfig } from "../../shared/mcp-manager.js";
import type { ResolvedMcpServer } from "../../shared/mcp-resolver.js";
import { sanitizeSchemaPatterns } from "../../shared/mcp-schema-sanitizer.js";
import type { McpToolListing } from "../../shared/mcp-tool-listing.js";
import type { ToolScope } from "../../shared/tool-lists.js";
import { inProcessServer, textResult } from "./in-process-server.js";

/** The most pages of tools one server's listing reads before the turn gives up on it. */
const MAX_LIST_PAGES = 100;

/** The engine's name for one server's tool. */
export function mcpToolName(slug: string, tool: string): string {
  return `mcp__${slug}__${tool}`;
}

/** One connected server as the engine sees it. */
interface BridgedServer {
  readonly slug: string;
  readonly client: Client;
  readonly tools: readonly Tool[];
}

/** A turn's servers, connected (the header). */
export interface McpBridge {
  /** The engine's in-process servers, by slug. */
  readonly servers: ReadonlyMap<string, McpServer>;
  /** Every tool the engine is offered, by its engine name. */
  readonly offered: ReadonlySet<string>;
  /** The server and tool an engine name stands for; undefined for a name no bridged server lists. */
  serverOf(toolName: string): { readonly slug: string; readonly tool: string } | undefined;
  /** What the servers listed, for the approval default. */
  readonly listing: McpToolListing;
  close(): Promise<void>;
}

/** Nothing connected: a turn with no servers. */
const NO_BRIDGE: McpBridge = {
  servers: new Map(),
  offered: new Set(),
  serverOf: () => undefined,
  listing: { listed: [], destructive: [], unlisted: [] },
  close: async () => undefined,
};

/** Connect the turn's `servers` and list what `scope` lets the engine see. */
export async function connectBridge(
  servers: readonly ResolvedMcpServer[],
  scope: ToolScope,
  platformServerSlugs: ReadonlySet<string>,
): Promise<McpBridge> {
  const config = toMcpClientConfig([...servers]);
  if (Object.keys(config).length === 0) return NO_BRIDGE;
  const connections = new MultiServerMCPClient(config);
  try {
    await connections.initializeConnections();
    const bridged: BridgedServer[] = [];
    for (const slug of Object.keys(config)) {
      const client = await connections.getClient(slug);
      if (client === undefined) throw new Error(`MCP server '${slug}' did not connect`);
      const inScope = (tool: Tool): boolean => platformServerSlugs.has(slug) || scope.allowsMcpTool(slug, tool.name);
      bridged.push({ slug, client, tools: (await listAllTools(slug, client)).filter(inScope) });
    }
    return bridgeOf(bridged, platformServerSlugs, () => connections.close());
  } catch (err) {
    await connections.close().catch(() => undefined);
    throw err;
  }
}

/** Every page of one server's tools, each schema loosened where it must be (the header). */
async function listAllTools(slug: string, client: Client): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const listed = await client.listTools(cursor === undefined ? undefined : { cursor });
    for (const tool of listed.tools) {
      const dropped = sanitizeSchemaPatterns(tool.inputSchema);
      if (dropped.length > 0) {
        console.warn(`[claude-mcp] server '${slug}' tool '${tool.name}': dropped ${dropped.length} regex pattern(s) that cannot compile under the unicode flag`);
      }
      tools.push(tool);
    }
    cursor = listed.nextCursor;
    pages += 1;
    if (cursor !== undefined && pages >= MAX_LIST_PAGES) throw new Error(`MCP server '${slug}' answered more than ${MAX_LIST_PAGES} pages of tools`);
  } while (cursor !== undefined);
  return tools;
}

/** The bridge over connected servers: one in-process server each, forwarding every call. */
function bridgeOf(bridged: readonly BridgedServer[], platformServerSlugs: ReadonlySet<string>, close: () => Promise<void>): McpBridge {
  const servers = new Map<string, McpServer>();
  const owners = new Map<string, { slug: string; tool: string }>();
  for (const server of bridged) {
    servers.set(server.slug, inProcessServer(server.slug, () => server.tools, (call) => forward(server, call.tool, call.args)));
    for (const tool of server.tools) owners.set(mcpToolName(server.slug, tool.name), { slug: server.slug, tool: tool.name });
  }
  const marked = bridged.filter((server) => !platformServerSlugs.has(server.slug));
  return {
    servers,
    offered: new Set(owners.keys()),
    serverOf: (toolName) => owners.get(toolName),
    listing: {
      listed: marked.map((server) => ({ server: server.slug, tools: server.tools.map((tool) => tool.name) })),
      destructive: marked.flatMap((server) =>
        server.tools.filter((tool) => tool.annotations?.destructiveHint === true).map((tool) => ({ server: server.slug, tool: tool.name })),
      ),
      unlisted: [],
    },
    close,
  };
}

/** One call, forwarded to its server unchanged; a call to a tool the server never listed in scope is refused. */
async function forward(server: BridgedServer, tool: string, args: Record<string, unknown>): Promise<CallToolResult> {
  if (!server.tools.some((listed) => listed.name === tool)) return textResult(`Tool '${tool}' is not available on server '${server.slug}'.`, true);
  try {
    return (await server.client.callTool({ name: tool, arguments: args })) as CallToolResult;
  } catch (err) {
    return textResult(`MCP server '${server.slug}' failed the call: ${err instanceof Error ? err.message : String(err)}`, true);
  }
}
