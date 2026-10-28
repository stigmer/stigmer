/**
 * Hermetic golden: an agent's MCP tool, called twice, through the whole
 * `ExecuteDeepAgent` activity, and the turn's record of the tool as the
 * model was offered it (stigmer#2366).
 *
 * Invariant pinned: the native engine hands the transcript builder what it
 * offered the model of each MCP tool it loaded (`turn.ts`,
 * `listingOfLoadedTools`), and the builder records the called tool's
 * definition once (`rows.mcp_tool_definitions`): its description, and the
 * schema the loader offered the model, which is the server's schema after
 * `@langchain/mcp-adapters` dereferenced and simplified it, never the raw
 * listing. The emitter writes it as ONE `stigmer.mcp.tool_definition`,
 * immediately before the tool's first `agent.mcp_tool_use` and naming that
 * use, and nothing before the second call. An eval case built from this
 * turn offers its stand-in the same tool from that event.
 *
 * The server is an agent's own HTTP server in this process
 * (`HttpMcpServer`). Its tool carries no `destructiveHint`, so the approval
 * default asks nothing of it (`shared/approval-policy.ts`: only an explicit
 * destructive mark asks) and both calls run ungated.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-deep-agent/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../../../shared/model-client.js", async () =>
  (await import("../../__test-utils__/scripted-model-module.js")).scriptedModelClientModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import {
  ScriptedClock,
  createHermeticEnvironment,
  type HermeticEnvironment,
  rowsGolden,
} from "../../../../__test-utils__/hermetic-activity.js";
import { HttpMcpServer } from "../../../../__test-utils__/http-mcp-server.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { beginDeepAgentScenario, deepAgentExecutionRecord, runDeepAgentTurn } from "../../__test-utils__/hermetic-deep-agent.js";
import { ToolCallStatus } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

const SERVER = "docs";
const TOOL = "lookup";
const DESCRIPTION = "Look a thing up in the docs.";
const FIRST_CALL = "call-hermetic-mcp-def-0001";
const SECOND_CALL = "call-hermetic-mcp-def-0002";
/** The server's own schema: a `$ref` the loader dereferences before the model sees it. */
const LISTED_SCHEMA = {
  type: "object" as const,
  properties: { q: { $ref: "#/$defs/query" } },
  required: ["q"],
  $defs: { query: { type: "string", description: "What to look up." } },
};

const docs = new HttpMcpServer([{ name: TOOL, description: DESCRIPTION, inputSchema: LISTED_SCHEMA }], async (_tool, args) => `Found ${String(args.q)}.`);

describe("ExecuteDeepAgent hermetic — an MCP tool's definition, recorded once", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  const clock = new ScriptedClock();

  beforeAll(async () => {
    await docs.start();
    env = createHermeticEnvironment();
    // The docs server is the one other origin the turn may dial.
    registry = stubRegistryFetch({ localOrigins: [docs.url] });
    clock.install();
  });

  afterAll(async () => {
    clock.uninstall();
    registry.restore();
    env.dispose();
    await docs.stop();
  });

  it("writes the tool as the model was offered it, once, just before its first use", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const record = deepAgentExecutionRecord({
      message: "Look up two things.",
      mcpServers: [{ name: SERVER, url: `${docs.url}/mcp` }],
    });
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      script: () => ({
        turns: [
          {
            text: "Looking up the first.",
            toolCalls: [{ id: FIRST_CALL, name: TOOL, args: { q: "alpha" } }],
            usage: { inputTokens: 1_500, outputTokens: 60 },
          },
          {
            text: "Now the second.",
            toolCalls: [{ id: SECOND_CALL, name: TOOL, args: { q: "beta" } }],
            usage: { inputTokens: 1_600, outputTokens: 50 },
          },
          { text: "Both found.", usage: { inputTokens: 1_700, outputTokens: 20 } },
        ],
      }),
    });

    // ── Act ──────────────────────────────────────────────────────────────────
    const invocation = await runDeepAgentTurn(scenario);

    // ── Assert: outcome and the two calls ────────────────────────────────────
    expect(invocation.outcome.kind).toBe("returned");
    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
    expect(record.toolCalls().map((row) => [row.id, row.name, row.mcpServerSlug, row.status, row.requiresApproval])).toEqual([
      [FIRST_CALL, TOOL, SERVER, ToolCallStatus.TOOL_CALL_COMPLETED, false],
      [SECOND_CALL, TOOL, SERVER, ToolCallStatus.TOOL_CALL_COMPLETED, false],
    ]);
    expect(docs.calls).toEqual([
      { tool: TOOL, args: { q: "alpha" } },
      { tool: TOOL, args: { q: "beta" } },
    ]);

    // ── Assert: one definition on the rows, as the loader offered it ─────────
    const final = record.lastFullStatus!;
    const rows = record.rowsOf(final);
    expect(rows.mcpToolDefinitions).toHaveLength(1);
    const [definition] = rows.mcpToolDefinitions;
    expect(definition!.mcpServerSlug).toBe(SERVER);
    expect(definition!.name).toBe(TOOL);
    expect(definition!.description).toBe(DESCRIPTION);
    expect(definition!.inputSchemaOmitted).toBe(false);
    expect(JSON.stringify(definition!.inputSchema), "the loader's dereferenced schema, not the raw listing").not.toContain("$ref");
    expect(definition!.inputSchema).toMatchObject({ type: "object", properties: { q: { type: "string" } }, required: ["q"] });

    // ── Assert: one event, immediately before the first use ──────────────────
    const events = record.sessionEvents;
    const definitions = events.flatMap((e, i) => (e.event.case === "stigmerMcpToolDefinition" ? [{ i, value: e.event.value }] : []));
    expect(definitions).toHaveLength(1);
    const uses = events.flatMap((e, i) => (e.event.case === "agentMcpToolUse" ? [{ i, value: e.event.value }] : []));
    expect(uses.map((u) => u.value.name)).toEqual([TOOL, TOOL]);
    expect(definitions[0]!.i, "just before the first use").toBe(uses[0]!.i - 1);
    expect(definitions[0]!.value.toolUseId).toBe(uses[0]!.value.id);
    expect(events[uses[1]!.i - 1]!.event.case, "nothing before the second call").not.toBe("stigmerMcpToolDefinition");
    expect(definitions[0]!.value).toMatchObject({ mcpServerName: SERVER, name: TOOL, description: DESCRIPTION, inputSchemaOmitted: false });
    expect(definitions[0]!.value.inputSchema).toEqual(definition!.inputSchema);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry") || u.startsWith(docs.url))).toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    await expect(rowsGolden(rows)).toMatchFileSnapshot("./goldens/mcp-tool-definition.rows.json");
    await expect(record.eventsGolden()).toMatchFileSnapshot("./goldens/mcp-tool-definition.events.json");
  });
});
