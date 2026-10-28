/**
 * Hermetic golden: an MCP tool's DEFINITION, as the model was offered it,
 * through the whole `ExecuteCursor` activity, for a tool the turn calls
 * twice.
 *
 * Invariant pinned (stigmer#2366): Cursor's SDK loads the agent's MCP tools
 * itself, so the runtime lists the declared server at turn start
 * (`harness/turn-context.ts` `listTurnTools`, Cursor's `readsToolMarks`
 * being false) and the adapter hands that listing's offered tools to the
 * turn's transcript builder (`execute-cursor/turn.ts`). The first row of
 * the tool records its definition once in `rows.mcp_tool_definitions`, with
 * the description and input schema the server listed, and the session log
 * holds one `stigmer.mcp.tool_definition` just before the tool's first
 * `agent.mcp_tool_use`, naming that use; the second call adds none. An eval
 * case built from the turn offers the model the same tool from it.
 *
 * Why the calls run without a person's answer: the server is the agent's
 * own, its listing succeeds, and its tool carries no `destructiveHint`, so
 * the approval default asks nothing for it (`shared/approval-policy.ts`:
 * only an explicit destructive mark or an unlisted server asks).
 *
 * Why this net exists: the sibling `mcp-tool-call.test.ts` declares no
 * server, so nothing is listed and nothing is offered; only a declared,
 * listed server proves the Cursor path from the runtime's listing to the
 * log.
 *
 * The server is a child process, not one in this process: the MCP SDK's
 * HTTP server transport loads `node:http2`, which must not load before the
 * Cursor adapter's boot installs its interceptor
 * (`src/__tests__/harness-boot-order.test.ts`), and the boot comes inside
 * the turn, after the server must already be listening.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-cursor/__tests__/hermetic -u
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

vi.mock("@cursor/sdk", async () =>
  (await import("../../__test-utils__/scripted-sdk.js")).scriptedCursorSdkModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import {
  ScriptedClock,
  createHermeticEnvironment,
  type HermeticEnvironment,
  statusGolden,
  rowsGolden,
  rowsGoldenPath,
} from "../../../../__test-utils__/hermetic-activity.js";
import { ScriptedCursorAgent, sdkEvents, step } from "../../__test-utils__/scripted-agent.js";
import {
  FIXTURE,
  SDK_CATALOG,
  beginCursorScenario,
  cursorExecutionRecord,
  runCursorTurn,
} from "../../__test-utils__/hermetic-cursor.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { ToolCallStatus } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

const AGENT_ID = "agent-hermetic-mcp-def-0001";
const RUN_ID = "run-hermetic-mcp-def-0001";
const FIRST_CALL = "call-hermetic-mcp-def-0001";
const SECOND_CALL = "call-hermetic-mcp-def-0002";
const USER_MESSAGE = "Ask the wiki about the fixture twice.";
const TEXT_BEFORE = "Asking the wiki.";
const TEXT_AFTER = "The wiki says the fixture is a readme.";
const MCP_SERVER = "deepwiki";
const MCP_TOOL = "ask_question";
const DESCRIPTION = "Ask a question about a GitHub repository.";
const INPUT_SCHEMA = {
  type: "object" as const,
  properties: { repoName: { type: "string" }, question: { type: "string" } },
  required: ["repoName", "question"],
};
const ANSWER = "It is a readme.";

const SDK_DIST = fileURLToPath(new URL("../../../../../node_modules/@modelcontextprotocol/sdk/dist/esm/", import.meta.url));

/** A streamable-HTTP MCP server listing `tools` and answering every call with `answer`; prints its port once it listens. */
function serverScript(tools: readonly unknown[], answer: string): string {
  const sdk = (path: string): string => JSON.stringify(pathToFileURL(join(SDK_DIST, path)).href);
  return `
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Server } from ${sdk("server/index.js")};
import { StreamableHTTPServerTransport } from ${sdk("server/streamableHttp.js")};
import { CallToolRequestSchema, ListToolsRequestSchema } from ${sdk("types.js")};

const TOOLS = ${JSON.stringify(tools)};
const sessions = new Map();
const http = createServer(async (req, res) => {
  const id = req.headers["mcp-session-id"];
  let transport = typeof id === "string" ? sessions.get(id) : undefined;
  if (transport === undefined) {
    const created = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: (sid) => sessions.set(sid, created) });
    const server = new Server({ name: "hermetic-wiki", version: "1.0.0" }, { capabilities: { tools: {} } });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
    server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: ${JSON.stringify(answer)} }] }));
    await server.connect(created);
    transport = created;
  }
  await transport.handleRequest(req, res);
});
http.listen(0, "127.0.0.1", () => process.stdout.write(String(http.address().port) + "\\n"));
`;
}

/** The SDK's MCP envelope for one call of the tool: the real identity is inside the `mcp` call's args. */
function mcpArgs(question: string): Record<string, unknown> {
  return { providerIdentifier: MCP_SERVER, toolName: MCP_TOOL, args: { repoName: "stigmer/fixture", question } };
}

describe("ExecuteCursor hermetic — an MCP tool's definition", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  const clock = new ScriptedClock();
  let dir: string;
  let wiki: ChildProcess;
  let wikiUrl: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "cursor-mcp-definition-"));
    const script = join(dir, "wiki-server.mjs");
    await writeFile(script, serverScript([{ name: MCP_TOOL, description: DESCRIPTION, inputSchema: INPUT_SCHEMA }], ANSWER));
    wiki = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "inherit"] });
    const [port] = await new Promise<string[]>((resolve, reject) => {
      wiki.once("error", reject);
      wiki.once("exit", (code) => reject(new Error(`the wiki server exited with ${String(code)} before it listened`)));
      createInterface({ input: wiki.stdout! }).once("line", (line) => resolve([line.trim()]));
    });
    wikiUrl = `http://127.0.0.1:${port}`;
    env = createHermeticEnvironment();
    // The runtime's listing dials the server; nothing else leaves the registry.
    registry = stubRegistryFetch({ localOrigins: [wikiUrl] });
    clock.install();
  });

  afterAll(async () => {
    clock.uninstall();
    registry.restore();
    env.dispose();
    wiki.kill();
    await rm(dir, { recursive: true, force: true });
  });

  it("records the tool as the turn's listing offered it, once, and writes it just before its first use", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const ev = sdkEvents(AGENT_ID, RUN_ID);
    const first = mcpArgs("What is the fixture?");
    const second = mcpArgs("Is it still a readme?");
    const agent = new ScriptedCursorAgent({
      agentId: AGENT_ID,
      runIds: [RUN_ID],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev.init()),
          step.event(ev.assistant(TEXT_BEFORE)),
          step.event(ev.toolCall(FIRST_CALL, "mcp", "running", first)),
          step.event(ev.toolCall(FIRST_CALL, "mcp", "completed", first, ANSWER)),
          step.event(ev.toolCall(SECOND_CALL, "mcp", "running", second)),
          step.event(ev.toolCall(SECOND_CALL, "mcp", "completed", second, ANSWER)),
          step.event(ev.assistant(TEXT_AFTER)),
          step.turnEnded({ inputTokens: 2_100, outputTokens: 80, cacheReadTokens: 0, cacheWriteTokens: 0 }),
          step.finished({ result: TEXT_AFTER, model: { id: FIXTURE.model, params: [] } }),
        ],
      ],
    });
    const record = cursorExecutionRecord({ message: USER_MESSAGE, mcpServers: [{ name: MCP_SERVER, url: `${wikiUrl}/mcp` }] });
    const scenario = beginCursorScenario({
      env,
      clock,
      record,
      sdk: { agents: [agent], catalog: SDK_CATALOG },
    });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runCursorTurn(scenario);

    // ── Assert: outcome ──────────────────────────────────────────────────────
    expect(invocation.outcome.kind).toBe("returned");
    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
    expect(record.persistedPhases.at(-1)).toBe(RunPhase.RUN_COMPLETED);
    expect(record.toolCalls().map((row) => [row.id, row.name, row.mcpServerSlug, row.status, row.requiresApproval])).toEqual([
      [FIRST_CALL, MCP_TOOL, MCP_SERVER, ToolCallStatus.TOOL_CALL_COMPLETED, false],
      [SECOND_CALL, MCP_TOOL, MCP_SERVER, ToolCallStatus.TOOL_CALL_COMPLETED, false],
    ]);

    // ── Assert: the definition on the rows, once ─────────────────────────────
    const final = record.lastFullStatus!;
    const rows = record.rowsOf(final);
    expect(rows.mcpToolDefinitions.map((d) => [d.mcpServerSlug, d.name, d.description, d.inputSchema, d.inputSchemaOmitted])).toEqual([
      [MCP_SERVER, MCP_TOOL, DESCRIPTION, INPUT_SCHEMA, false],
    ]);

    // ── Assert: the definition in the log, just before the first use ─────────
    const events = record.sessionEvents.map((e) => e.event);
    const definitions = events.flatMap((e, index) => (e.case === "stigmerMcpToolDefinition" ? [{ index, value: e.value }] : []));
    const uses = events.flatMap((e, index) => (e.case === "agentMcpToolUse" ? [{ index, id: e.value.id }] : []));
    expect(definitions, "one definition for the tool, whatever the number of calls").toHaveLength(1);
    expect(uses).toHaveLength(2);
    expect(definitions[0]!.index, "immediately before the tool's first use").toBe(uses[0]!.index - 1);
    expect(definitions[0]!.value).toMatchObject({
      toolUseId: uses[0]!.id,
      mcpServerName: MCP_SERVER,
      name: MCP_TOOL,
      description: DESCRIPTION,
      inputSchema: INPUT_SCHEMA,
      inputSchemaOmitted: false,
    });
    expect(events[uses[1]!.index - 1]?.case, "none before the second call").not.toBe("stigmerMcpToolDefinition");

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry") || u.startsWith(`${wikiUrl}/mcp`))).toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    await expect(statusGolden(final)).toMatchFileSnapshot("./goldens/mcp-tool-definition.status.json");
    await expect(rowsGolden(rows)).toMatchFileSnapshot(rowsGoldenPath("./goldens/mcp-tool-definition.status.json"));
    await expect(record.eventsGolden()).toMatchFileSnapshot("./goldens/mcp-tool-definition.events.json");
  });
});
