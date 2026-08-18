// A long-lived, TS-pure HTTP (Streamable) MCP server fixture for the execution
// suites — the harness's first real *tool* surface.
// Domain: conformance harness (execution engine).
//
// HITL/tool-approval is the first slice that needs a genuine tool: the runner's
// approval gate keys off a tool name, and there is no built-in approval-gated
// tool, so a conformance agent can only reach EXECUTION_WAITING_FOR_APPROVAL by
// referencing a real McpServer that exposes a real tool. This fixture is that
// tool surface, and (like mock-llm.ts) it is TS-pure on purpose — no reuse of
// the Go test/integration MCP servers — to preserve the suite's
// no-cross-language-coupling property (DD-002).
//
// Why no `connect`/discovery is needed (and the McpServer just needs `create`):
// at execution setup the runner resolves MCP servers from their *spec*, connects
// LIVE, lists tools, and builds the approval gate from the agent's
// tool_approval_overrides — none of which depends on a prior discovery pass
// (and the conformance runner sets SKIP_MCP_CONNECT_BACKFILL=true, so the
// execution-time backfill is a no-op). See execute-deep-agent/setup.ts and
// shared/approval-policy.ts in the runner. The agent points at this server's URL
// and the runner reaches it directly.
//
// Transport choice: stateless Streamable HTTP. Each POST gets a fresh
// McpServer + transport (sessionIdGenerator: undefined), so independent runner
// connections over the fixture's lifetime never share session state and nothing
// leaks between executions — the right default for a stateless `echo` tool, and
// the behavioral match to the Go reference fixture (mcp_http_server.go). The
// fixture is booted once per file and must OUTLIVE every execution (the runner
// connects at each execution's setup), so it is closed only in afterAll.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// The single tool this fixture exposes. Deterministic by construction: it echoes
// its `text` argument straight back, so a tool call's result is fully assertable
// without any external dependency. The name is bare (no server prefix) because
// the runner binds MCP tools by their bare names — the agent's approval override
// and the mock LLM's tool_use turn both reference exactly this string.
export const ECHO_TOOL_NAME = "echo";

// Build a fresh MCP server exposing only `echo`. Called per request (stateless
// mode), so registration is cheap and self-contained.
function buildEchoServer(): McpServer {
  const server = new McpServer({ name: "conformance-mcp-fixture", version: "1.0.0" });
  server.registerTool(
    ECHO_TOOL_NAME,
    {
      description: "Returns the input text unchanged. For deterministic conformance assertions.",
      inputSchema: { text: z.string().describe("the value to echo back") },
    },
    ({ text }) => ({ content: [{ type: "text", text }] }),
  );
  return server;
}

// One JSON-RPC request as observed by the fixture: the method from the body
// plus the HTTP headers it arrived with (node lowercases header names). This
// is the wire-level observation point the caller-identity contract needs
// (stigmer#382): identity reaches an MCP server ONLY as templated headers, so
// the receiving server — this fixture — is the one place a test can assert
// what actually crossed the wire.
export interface CapturedMcpRequest {
  method: string;
  headers: Record<string, string | string[] | undefined>;
}

export class McpToolFixture {
  private server: Server | undefined;
  private captured: CapturedMcpRequest[] = [];

  // Every JSON-RPC request observed since the last reset, oldest first.
  // Suites reset in afterEach (the mock-LLM convention) so captures never
  // leak across tests within a file.
  capturedRequests(): readonly CapturedMcpRequest[] {
    return this.captured;
  }

  resetCaptured(): void {
    this.captured = [];
  }

  // Binds to an ephemeral loopback port; resolves once listening.
  async start(): Promise<void> {
    const server = createServer((req, res) => {
      this.handle(req, res).catch(() => {
        // A handler failure (e.g. a client that vanished mid-stream) must never
        // crash the server that other tests in the file still depend on.
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "internal error" } }));
        } else if (!res.writableEnded) {
          res.destroy();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    this.server = server;
  }

  // The McpServer http.url to register: the MCP client POSTs JSON-RPC here.
  url(): string {
    if (this.server === undefined) {
      throw new Error("McpToolFixture.start() must be called before url()");
    }
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/mcp`;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (server === undefined) {
      return;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Streamable HTTP carries every JSON-RPC request (initialize, tools/list,
    // tools/call) over POST. Stateless mode does not support the optional GET
    // notification stream or DELETE session-teardown, so those get a clean 405
    // the MCP client tolerates (it simply forgoes server-initiated streams).
    if (req.method !== "POST") {
      res.writeHead(405, { "content-type": "application/json", allow: "POST" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "method not allowed" } }));
      return;
    }

    // Buffer and parse the body ourselves so each request can be captured with
    // its JSON-RPC method (stigmer#382 asserts headers per wire request). The
    // transport accepts a pre-parsed body for exactly this pattern.
    const body: unknown = JSON.parse(await readBody(req));
    for (const method of jsonRpcMethods(body)) {
      this.captured.push({ method, headers: { ...req.headers } });
    }

    const mcp = buildEchoServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res, body);
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// JSON-RPC over Streamable HTTP is a single message or a batch array; capture
// one entry per message so batch requests stay individually assertable.
function jsonRpcMethods(body: unknown): string[] {
  const messages = Array.isArray(body) ? body : [body];
  return messages.map((message) => {
    const method = (message as { method?: unknown } | null)?.method;
    return typeof method === "string" ? method : "(no method)";
  });
}
