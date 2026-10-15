/**
 * A eval-run try's stand-ins for the plugin's MCP servers: one
 * Streamable HTTP MCP endpoint on loopback for the turn, serving one
 * server per mocked plugin server under that server's own name, so both
 * engines reach it as they reach any HTTP server and the transcript records
 * its calls under the plugin server's name.
 *
 * What each stand-in offers: the tools the case mocks, with the real
 * server's descriptions and input schemas when its `_tools.json` holds them
 * and a permissive object schema otherwise. A tool with no mock is not
 * offered. The server planned all of this (`RunSpec.eval_case`); the
 * bytes come from the plugin's archive.
 *
 * How a call is answered:
 *  1. Its `expect:` guard is checked first (`@stigmer/eval-runtime`, the
 *     whole value, linear). A violation stops the try: the turn is told to
 *     stop with the reason, reported `aborted`, score 0, and the call is
 *     answered with that reason.
 *  2. A `fixed` mock returns its body rendered with the call's input and
 *     its fixtures, the case's `mocks/<server>/fixtures/` before the
 *     suite's; `error: true` returns it as a tool error.
 *  3. An `agent` mock asks the agent-mock model (`agent-mock.ts`). Agent
 *     mocks share one call budget per try (four times the case's
 *     `max_turns`); a call past it stops the try. Each answer's cost joins
 *     the try's estimate and cap, and an answer that ends the run stops it.
 *
 * The endpoint takes a per-turn bearer token, so nothing else on the host
 * can call it, and it is closed when the turn ends. A stop or a cost is
 * reported through the binding the turn runtime gives it once the engine's
 * turn starts (`bind`); a call before that has nowhere to report and is
 * refused.
 */

import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from "@modelcontextprotocol/sdk/types.js";
import {
  checkExpect,
  compileExpect,
  mockBodyOf,
  parseToolsList,
  renderMockAnswer,
  type CompiledExpect,
} from "@stigmer/eval-runtime";
import {
  EvalMockKind,
  type EvalCaseContext,
  type EvalMockServer,
  type EvalMockTool,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/eval_case_pb";
import type { MockAbort } from "../../harness/stop-controller.js";
import type { ResolvedMcpServer } from "../mcp-resolver.js";
import type { AgentMockExchange, AgentMockModel } from "./agent-mock.js";
import type { CaseArchive } from "./case-archive.js";

/** Where the endpoint reports to, once the engine's turn starts. */
export interface MockEndpointBinding {
  /** Stop the try: a guard was violated, an agent mock ended it, or the budget ran out. */
  readonly onAbort: (abort: MockAbort) => void;
  /** An agent mock's answer cost this much (estimated US dollars). */
  readonly onCost: (costUsd: number) => void;
}

/** The running endpoint. */
export interface MockEndpoint {
  /** The stand-ins, as the turn's server list carries them; each replaces the plugin's server of the same name. */
  readonly servers: readonly ResolvedMcpServer[];
  /** Each stand-in's mocked tools, as a turn's tool listing names them (`McpToolListing.listed`). */
  readonly listed: readonly { readonly server: string; readonly tools: readonly string[] }[];
  bind(binding: MockEndpointBinding): void;
  close(): Promise<void>;
}

/** The schema a mocked tool without a saved one is offered with. */
const PERMISSIVE_SCHEMA = { type: "object", additionalProperties: true } as const;

/** One mocked tool, ready to answer. */
interface ToolStandIn {
  readonly mock: EvalMockTool;
  readonly listing: Tool;
  readonly expect: CompiledExpect | undefined;
}

/** One mocked server, ready to answer. */
interface ServerStandIn {
  readonly server: EvalMockServer;
  readonly tools: ReadonlyMap<string, ToolStandIn>;
  /** Its agent mocks' earlier exchanges, oldest first. */
  readonly history: AgentMockExchange[];
}

/**
 * Start the endpoint for a try whose case mocks servers; `undefined` when
 * it mocks none. Every mock file must be in the archive: the server read
 * them from it.
 */
export async function startMockEndpoint(args: {
  readonly context: EvalCaseContext;
  readonly archive: CaseArchive;
  readonly agentModel: AgentMockModel;
}): Promise<MockEndpoint | undefined> {
  const { context, archive, agentModel } = args;
  if (context.mocks.length === 0) return undefined;
  const standIns = new Map<string, ServerStandIn>();
  for (const server of context.mocks) standIns.set(server.segment, standInOf(server, archive));

  const token = randomBytes(24).toString("hex");
  let binding: MockEndpointBinding | undefined;
  let agentCalls = 0;
  const budget = context.agentMockCallBudget;

  const answer = async (standIn: ServerStandIn, name: string, input: Record<string, unknown>): Promise<CallToolResult> => {
    const tool = standIn.tools.get(name);
    if (tool === undefined) return toolError(`the tool '${name}' is not mocked`);
    const report = binding;
    if (report === undefined) return toolError("the mock is not ready");
    // The stopping call answers with plain text, not a tool error: the turn
    // is already being stopped, and a tool error raced against that stop
    // escapes the native engine's stream as an unhandled rejection.
    const stop = (reason: string): CallToolResult => {
      report.onAbort({ server: standIn.server.server, tool: name, reason });
      return { content: [{ type: "text", text: `This call stopped the test: ${reason}` }] };
    };
    if (tool.expect !== undefined) {
      const violation = checkExpect(tool.expect, input);
      if (violation !== undefined) return stop(violation);
    }
    const body = mockBodyOf(archive.text(tool.mock.file) ?? "");
    if (tool.mock.kind === EvalMockKind.fixed) {
      const rendered = renderMockAnswer(body, input, (path) => fixtureOf(context, archive, standIn.server.server, path));
      if (!rendered.ok) return toolError(rendered.error);
      return { content: [{ type: "text", text: rendered.text }], ...(tool.mock.error && { isError: true }) };
    }
    if (agentCalls >= budget) return stop(`the agent mocks' call budget of ${budget} calls ran out`);
    agentCalls++;
    const reply = await agentModel({
      server: standIn.server.server,
      tool: name,
      instructions: body,
      abortWhen: tool.mock.abortWhen,
      input,
      history: [...standIn.history],
    });
    report.onCost(reply.costUsd);
    if (reply.kind === "abort") return stop(reply.reason);
    standIn.history.push({ tool: name, input, answer: reply.text });
    return { content: [{ type: "text", text: reply.text }] };
  };

  const http = createServer((req, res) => {
    void serve(req, res, token, standIns, answer);
  });
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(0, "127.0.0.1", () => resolve());
  });
  const address = http.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  return {
    servers: [...standIns.values()].map(({ server }) => resolvedServerOf(context, server, port, token)),
    listed: [...standIns.values()].map(({ server, tools }) => ({ server: server.segment, tools: [...tools.keys()] })),
    bind: (next) => {
      binding = next;
    },
    close: () => closeServer(http),
  };
}

function standInOf(server: EvalMockServer, archive: CaseArchive): ServerStandIn {
  const saved = new Map(
    (server.toolsFile === "" ? [] : parseToolsList(archive.text(server.toolsFile) ?? "")).map((tool) => [tool.name, tool] as const),
  );
  const tools = new Map<string, ToolStandIn>();
  for (const mock of server.tools) {
    const real = saved.get(mock.tool);
    const compiled = mock.expectJson === "" ? undefined : compileExpect(JSON.parse(mock.expectJson));
    tools.set(mock.tool, {
      mock,
      listing: {
        name: mock.tool,
        description: real?.description ?? `The ${mock.tool} tool of ${server.server}.`,
        inputSchema: (real?.inputSchema ?? PERMISSIVE_SCHEMA) as Tool["inputSchema"],
      },
      expect: compiled?.ok === true ? compiled.expect : undefined,
    });
  }
  return { server, tools, history: [] };
}

/** A fixture beside the mock: the case's mocks directory first, then the suite's. */
function fixtureOf(context: EvalCaseContext, archive: CaseArchive, server: string, path: string): string | undefined {
  return archive.text(`${context.caseDir}/mocks/${server}/${path}`) ?? archive.text(`${context.suiteDir}/mocks/${server}/${path}`);
}

function resolvedServerOf(
  context: EvalCaseContext,
  server: EvalMockServer,
  port: number,
  token: string,
): ResolvedMcpServer {
  return {
    slug: server.segment,
    connectionType: "http",
    url: `http://127.0.0.1:${port}/mcp/${encodeURIComponent(server.segment)}`,
    headers: { Authorization: `Bearer ${token}` },
    home: { kind: "plugin", pluginId: context.pluginId, plugin: context.pluginName, server: server.server },
  };
}

function toolError(text: string): CallToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** One HTTP request: authorised, routed to its stand-in, and served by a stateless MCP server. */
async function serve(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
  standIns: ReadonlyMap<string, ServerStandIn>,
  answer: (standIn: ServerStandIn, name: string, input: Record<string, unknown>) => Promise<CallToolResult>,
): Promise<void> {
  if (req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401).end();
    return;
  }
  const match = /^\/mcp\/([^/?]+)/.exec(req.url ?? "");
  const standIn = match === null ? undefined : standIns.get(decodeURIComponent(match[1] ?? ""));
  if (standIn === undefined) {
    res.writeHead(404).end();
    return;
  }
  const mcp = new Server({ name: standIn.server.segment, version: "1.0.0" }, { capabilities: { tools: {} } });
  mcp.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [...standIn.tools.values()].map((tool) => tool.listing) }));
  mcp.setRequestHandler(CallToolRequestSchema, (request) =>
    answer(standIn, request.params.name, (request.params.arguments ?? {}) as Record<string, unknown>),
  );
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => {
    void transport.close();
    void mcp.close();
  });
  try {
    await mcp.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    console.warn(`[eval-case mocks] request failed: ${err instanceof Error ? err.message : String(err)}`);
    if (!res.headersSent) res.writeHead(500).end();
  }
}

function closeServer(http: HttpServer): Promise<void> {
  return new Promise((resolve) => {
    http.closeAllConnections();
    http.close(() => resolve());
  });
}
