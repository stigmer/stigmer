/**
 * An MCP server over streamable HTTP, in the test process, for a hermetic
 * turn to reach as it reaches any HTTP server: an agent's own server on any
 * engine, or, on Claude, the platform's memory server at its bridge route
 * (`execute-claude/mcp-bridge.ts`).
 *
 * It lists the tools it is given and answers each call with what `call`
 * returns, which may wait: a call is held for as long as `call` takes, so a
 * scenario can look at the machine while the engine waits on it. Every
 * request's path and headers are kept, so a scenario can read what the
 * bridge sent.
 */

import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";

/** One request as the server received it. */
export interface HttpMcpRequest {
  readonly path: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

/** What a scenario's server answers a call with: its text. */
export type HttpMcpCall = (tool: string, args: Record<string, unknown>) => Promise<string>;

export class HttpMcpServer {
  readonly requests: HttpMcpRequest[] = [];
  readonly calls: { readonly tool: string; readonly args: Record<string, unknown> }[] = [];
  private server: HttpServer | undefined;
  private readonly sessions = new Map<string, StreamableHTTPServerTransport>();
  private address = "";

  constructor(
    private readonly tools: readonly Tool[],
    private readonly call: HttpMcpCall,
  ) {}

  /** The server's base URL; a route appended to it is served the same. */
  get url(): string {
    return this.address;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve));
    this.address = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  async stop(): Promise<void> {
    for (const transport of this.sessions.values()) await transport.close();
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => (this.server === undefined ? resolve() : this.server.close(() => resolve())));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    this.requests.push({ path: req.url ?? "", headers: req.headers });
    const id = req.headers["mcp-session-id"];
    let transport = typeof id === "string" ? this.sessions.get(id) : undefined;
    if (transport === undefined) {
      const created: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => void this.sessions.set(sid, created),
      });
      const server = new Server({ name: "hermetic-http", version: "1.0.0" }, { capabilities: { tools: {} } });
      server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...this.tools] }));
      server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const args = (request.params.arguments ?? {}) as Record<string, unknown>;
        this.calls.push({ tool: request.params.name, args });
        return { content: [{ type: "text", text: await this.call(request.params.name, args) }] };
      });
      await server.connect(created);
      transport = created;
    }
    await transport.handleRequest(req, res);
  }
}
