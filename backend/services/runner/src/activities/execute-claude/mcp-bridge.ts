/**
 * Every MCP server of a Claude turn, connected by the agent host and served
 * to the engine by the host itself (`loopback-mcp.ts`).
 *
 * The engine could start a stdio server itself and dial an HTTP one with its
 * headers, but either would undo what this harness keeps: the SDK puts an
 * external server's configuration, its login header included, on the
 * engine's command line, which every user of the machine can read, and a
 * stdio server it started would be its child, able to read its environment.
 * So the host connects each server exactly as the native engine does (the
 * shared connection config, `shared/mcp-manager.ts` `toMcpClientConfig`: a
 * stdio server's declared environment and nothing else, an HTTP server's
 * headers, reconnects), and the engine sees each one as a server the host
 * serves under the same slug (`loopback-mcp.ts`), whose `tools/list` and
 * `tools/call` are forwarded unchanged, a call only once the gate admitted
 * it. The platform's own servers (channel,
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
 *  - the agents' tool lists: a tool no agent of the turn may call is never
 *    listed to the engine. The platform's servers are outside every list
 *    (`shared/tool-lists.ts`).
 *
 * One connection per server, whichever agents have it: the main agent's
 * servers and each saved sub-agent's own, a server two of them have being
 * the same server by its slug (the runtime refuses a clash first,
 * `harness/turn-context.ts`). The engine holds no server for one sub-agent
 * alone (measured on SDK 0.3.310), so each is one served view of the
 * union of what its agents may call; each agent is narrowed to its own by
 * its definition and by the gate's closed world (`agents.ts`, `gate.ts`).
 *
 * Every connection is closed when the turn ends (`turn.ts`).
 */

import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

import { toMcpClientConfig } from "../../shared/mcp-manager.js";
import type { ResolvedMcpServer } from "../../shared/mcp-resolver.js";
import { sanitizeSchemaPatterns } from "../../shared/mcp-schema-sanitizer.js";
import type { McpToolListing } from "../../shared/mcp-tool-listing.js";
import { textResult, type ServedServer } from "./loopback-mcp.js";

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
  /** The servers the host serves the engine, by slug. */
  readonly servers: ReadonlyMap<string, ServedServer>;
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

/** Connect the turn's `servers` and list the tools `inScope` says some agent of the turn may call (a platform server's, always). */
export async function connectBridge(
  servers: readonly ResolvedMcpServer[],
  inScope: (slug: string, tool: string) => boolean,
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
      const listed = (tool: Tool): boolean => platformServerSlugs.has(slug) || inScope(slug, tool.name);
      bridged.push({ slug, client, tools: (await listAllTools(slug, client)).filter(listed) });
    }
    return bridgeOf(bridged, platformServerSlugs, () => connections.close());
  } catch (err) {
    try {
      await connections.close();
    } catch {
      // The connect failure is the one to report.
    }
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

/** The bridge over connected servers: one served server each, forwarding every call. */
function bridgeOf(bridged: readonly BridgedServer[], platformServerSlugs: ReadonlySet<string>, close: () => Promise<void>): McpBridge {
  const servers = new Map<string, ServedServer>();
  const owners = new Map<string, { slug: string; tool: string }>();
  for (const server of bridged) {
    servers.set(server.slug, { name: server.slug, tools: () => server.tools, call: (call) => forward(server, call.tool, call.args) });
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
