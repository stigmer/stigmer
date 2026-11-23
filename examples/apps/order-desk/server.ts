/**
 * The order desk's tool server: two read-only tools over MCP (Streamable
 * HTTP), `look_up_order` and `refund_policy`, on the shop's data in
 * orders.ts. A Stigmer agent calls them from wherever its turn runs, so the
 * server must be reachable from the internet (on your laptop, through a
 * tunnel), and a tunnel puts it on the open internet: every request must
 * carry `Authorization: Bearer <ORDER_DESK_TOKEN>`, or it is refused.
 *
 * Stateless: each request gets a fresh MCP server and transport, so nothing
 * is shared between calls.
 *
 *   ORDER_DESK_TOKEN=<a long random string> npm start      # listens on PORT, 8787 by default
 */
import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { ORDERS, REFUND_POLICY } from "./orders.js";

/** The two tools, on a fresh MCP server; `log` hears each call. */
function tools(log: (line: string) => void): McpServer {
  const mcp = new McpServer({ name: "order-desk", version: "1.0.0" });
  mcp.registerTool(
    "look_up_order",
    {
      description:
        "Looks up one of the shop's orders by its number and returns its status, items (with whether each is final sale), carrier, tracking number, delivery date and the last day it can be returned.",
      inputSchema: { order_id: z.string().describe("The order number, four digits, like 1042") },
      annotations: { readOnlyHint: true },
    },
    ({ order_id }) => {
      log(`look_up_order ${order_id}`);
      const order = ORDERS[order_id];
      return order === undefined
        ? { isError: true, content: [{ type: "text", text: `No order ${order_id}. Order numbers are four digits, like 1042.` }] }
        : { content: [{ type: "text", text: JSON.stringify(order) }] };
    },
  );
  mcp.registerTool(
    "refund_policy",
    {
      description: "Returns the shop's refund and return policy.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => {
      log("refund_policy");
      return { content: [{ type: "text", text: REFUND_POLICY }] };
    },
  );
  return mcp;
}

/** Whether the request's `Authorization` header is `Bearer <token>`, compared in constant time. */
function carriesKey(req: IncomingMessage, token: string): boolean {
  const given = Buffer.from(req.headers.authorization ?? "");
  const wanted = Buffer.from(`Bearer ${token}`);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

/** The HTTP server, not yet listening: `/mcp` for callers with `token`, 401 for everyone else. */
export function orderDeskServer(token: string, log: (line: string) => void = console.log): Server {
  return createServer(async (req, res) => {
    if (new URL(req.url ?? "/", "http://localhost").pathname !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    if (!carriesKey(req, token)) {
      log(`refused a call without the key from ${req.socket.remoteAddress ?? "an unknown address"}`);
      res.writeHead(401, { "Content-Type": "text/plain" }).end("This server needs its key.\n");
      return;
    }
    const mcp = tools(log);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void mcp.close();
    });
    await mcp.connect(transport);
    await transport.handleRequest(req, res);
  });
}

function main(): void {
  const token = process.env.ORDER_DESK_TOKEN ?? "";
  if (token.length < 16) {
    console.error("Set ORDER_DESK_TOKEN to a long random string first, for example: export ORDER_DESK_TOKEN=$(openssl rand -hex 24)");
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? 8787);
  orderDeskServer(token).listen(port, () => {
    console.log(`Order desk tools at http://localhost:${port}/mcp. Calls without the key are refused.`);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
