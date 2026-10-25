/**
 * Hermetic golden: MCP servers on a Claude turn, on the real engine, through
 * the host's bridge (`mcp-bridge.ts`).
 *
 * The host connects every server itself and hands each to the engine as an
 * in-process server, so:
 *
 *  - an agent's own server is reached with its login header, and that
 *    header is on no process's command line while the engine works (the
 *    SDK puts an `http` server's config on the engine's argv, which every
 *    user on the machine can read; the bridge never gives it one);
 *  - the platform's memory server, a synthesized attachment at the bridge
 *    endpoint, is reached the same way, with the run's attribution headers;
 *  - the engine's tools keep Claude Code's names, `mcp__<server>__<tool>`,
 *    behind the engine's tool search, and a call's result is the server's.
 *
 * A stdio server is the same bridge with another transport; that it is the
 * host's child and never the engine's is `__tests__/mcp-bridge.test.ts`'s.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { create } from "@bufbuild/protobuf";
import { RecalledMemoriesSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/spec_pb";

vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { ScriptedClock, createHermeticEnvironment, rowsGolden, rowsGoldenPath, statusGolden } from "../../../../__test-utils__/hermetic-activity.js";
import { MEMORY_EXECUTION_ID_HEADER, MEMORY_ROUTE } from "../../../../shared/memory-attachment.js";
import { ToolCallStatus } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { anthropicText, anthropicToolUses, type WireConversation } from "../../__test-utils__/claude-wire.js";
import { FIXTURE, claudeExecutionRecord, claudeScenarioFile, type ClaudeScenarioFile } from "../../__test-utils__/hermetic-claude.js";
import { HttpMcpServer } from "../../__test-utils__/http-mcp-server.js";

const SECRET = "hermetic-mcp-login-5f2b9c";
const GOLDEN = "./goldens/mcp-servers.status.json";
const OBJECT = { type: "object" as const, properties: { q: { type: "string" } } };

/** What every process on the machine was started with, as `ps` shows anyone. */
function commandLines(): string[] {
  return execFileSync("ps", ["-axww", "-o", "command="], { encoding: "utf8" }).split("\n");
}

const seenWhileWorking: string[][] = [];
const docs = new HttpMcpServer([{ name: "lookup", description: "Look a thing up.", inputSchema: OBJECT }], async () => {
  seenWhileWorking.push(commandLines());
  return "Found it.";
});
const memory = new HttpMcpServer([{ name: "remember", description: "Remember a fact.", inputSchema: OBJECT }], async () => "Remembered.");

const env = createHermeticEnvironment();
const clock = new ScriptedClock();
let file: ClaudeScenarioFile;

describe("ExecuteClaude hermetic — MCP servers through the host's bridge", () => {
  beforeAll(async () => {
    await docs.start();
    await memory.start();
    file = claudeScenarioFile(env, clock, { mcpBridgeEndpoint: memory.url }, [docs.url, memory.url]);
    await file.start();
  });
  afterAll(async () => {
    await file.stop();
    await docs.stop();
    await memory.stop();
  });

  it("an agent's server and the platform's memory server are called by the host, with no header on any command line", async () => {
    const record = claudeExecutionRecord({
      message: "Look it up and remember it.",
      mcpServers: [{ name: "docs", url: `${docs.url}/mcp`, headers: { Authorization: `Bearer ${SECRET}` } }],
    });
    record.execution.status!.recalledMemories = create(RecalledMemoriesSchema, { enabled: true });
    const steps = [
      { id: "toolu_mcp_load", name: "ToolSearch", input: { query: "select:mcp__docs__lookup,mcp__stigmer-memory__remember", max_results: 2 } },
      { id: "toolu_mcp_docs", name: "mcp__docs__lookup", input: { q: "the thing" } },
      { id: "toolu_mcp_memory", name: "mcp__stigmer-memory__remember", input: { q: "the thing is found" } },
    ];
    let tools: readonly string[] = [];
    const invocation = await file.run(record, (c: WireConversation) => {
      if (tools.length === 0) tools = c.toolNames;
      const next = steps.find((step) => !c.issued.has(step.id));
      return next === undefined ? anthropicText("Done.") : anthropicToolUses([{ toolCallId: next.id, toolName: next.name, toolInput: next.input }]);
    });

    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
    expect(record.toolCalls().map((row) => [row.name, row.status, row.result])).toEqual([
      ["ToolSearch", ToolCallStatus.TOOL_CALL_COMPLETED, "mcp__docs__lookup\nmcp__stigmer-memory__remember"],
      ["mcp__docs__lookup", ToolCallStatus.TOOL_CALL_COMPLETED, "Found it."],
      ["mcp__stigmer-memory__remember", ToolCallStatus.TOOL_CALL_COMPLETED, "Remembered."],
    ]);
    expect(tools, "MCP tools are deferred behind the engine's tool search").toContain("ToolSearch");
    expect(docs.calls).toEqual([{ tool: "lookup", args: { q: "the thing" } }]);
    expect(memory.calls).toEqual([{ tool: "remember", args: { q: "the thing is found" } }]);

    expect(docs.requests.every((r) => r.headers.authorization === `Bearer ${SECRET}`), "the host sends the agent's login").toBe(true);
    expect(memory.requests.every((r) => r.path.startsWith(MEMORY_ROUTE)), "the memory server is reached at its bridge route").toBe(true);
    expect(memory.requests.some((r) => r.headers[MEMORY_EXECUTION_ID_HEADER] === FIXTURE.executionId)).toBe(true);

    expect(seenWhileWorking).toHaveLength(1);
    const lines = seenWhileWorking[0]!;
    expect(lines.some((line) => line.includes("claude-agent-sdk")), "the engine was running while the call was held").toBe(true);
    expect(lines.filter((line) => line.includes(SECRET)), "no process was started with the server's login").toEqual([]);

    const final = record.lastFullStatus!;
    const json = statusGolden(final);
    expect(json).not.toContain(SECRET);
    await expect(json).toMatchFileSnapshot(GOLDEN);
    await expect(rowsGolden(record.rowsOf(final))).toMatchFileSnapshot(rowsGoldenPath(GOLDEN));
    await expect(record.eventsGolden()).toMatchFileSnapshot("./goldens/mcp-servers.events.json");
  });
});
