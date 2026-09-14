/**
 * Hermetic golden: an MCP TOOL CALL — the SDK reports the call as `name: "mcp"`
 * and packs the real identity into its args — through the whole
 * `ExecuteCursor` activity.
 *
 * Invariant pinned (S4 M0 net): `extractMcpToolDetails` unwraps
 * `{ providerIdentifier, toolName, args }` from the event's args, and
 * `buildToolCallProto` writes the row as the INNER tool: `name` is `toolName`,
 * `mcpServerSlug` is `providerIdentifier`, `args` is the inner args,
 * `toolKind` is MCP, and (today) `argsPreview` is the OUTER args stringified —
 * the envelope, not the arguments. With no MCP server declared on the record
 * there is no policy for the tool, so it is not gated; the provenance stamp
 * still names the layer that cleared it.
 *
 * Predicted under the S4 rulings (`T01_1_review.md`, 2026-09-14): ONE hunk at
 * M4, under Q-S4-16. `argsPreview` becomes the elided preview of the row's own
 * `args` — `{"query":"fixture"}` — because the canonical builder derives every
 * row's preview from its `args` through the one sanitizer, and never from an
 * engine's envelope. Nothing else in this golden moves; a second hunk is a
 * pause.
 *
 * Why this net exists: no Cursor golden before M0 carried an MCP-attributed
 * row, and the unwrapping moves whole into the Cursor translator at M4.
 *
 * Regenerate ONLY after a deliberate behavior change:
 *   npx vitest run src/activities/execute-cursor/__tests__/hermetic -u
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { toJson } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase, ToolCallStatus, ToolKind } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

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

const AGENT_ID = "agent-hermetic-mcp-0001";
const RUN_ID = "run-hermetic-mcp-0001";
const CALL_ID = "call-hermetic-mcp-0001";
const USER_MESSAGE = "Search the docs for the fixture.";
const TEXT_BEFORE = "Searching the docs.";
const MCP_SERVER = "hermetic-docs";
const MCP_TOOL = "search_docs";
const INNER_ARGS = { query: "fixture" };
/** The SDK's MCP envelope: the real identity is inside the `mcp` call's args. */
const MCP_EVENT_ARGS = { providerIdentifier: MCP_SERVER, toolName: MCP_TOOL, args: INNER_ARGS };
const MCP_RESULT = "1 result: README.md — A fixture readme.";
const TEXT_AFTER = "One document mentions the fixture: README.md.";

describe("ExecuteCursor hermetic — MCP tool call", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  const clock = new ScriptedClock();

  beforeAll(() => {
    env = createHermeticEnvironment();
    registry = stubRegistryFetch();
    clock.install();
  });

  afterAll(() => {
    clock.uninstall();
    registry.restore();
    env.dispose();
  });

  it("writes the row as the inner tool with its server slug and completes", async () => {
    // ── Arrange ──────────────────────────────────────────────────────────────
    const ev = sdkEvents(AGENT_ID, RUN_ID);
    const agent = new ScriptedCursorAgent({
      agentId: AGENT_ID,
      runIds: [RUN_ID],
      observeStep: () => clock.tick(),
      turns: [
        [
          step.event(ev.init()),
          step.event(ev.assistant(TEXT_BEFORE)),
          step.event(ev.toolCall(CALL_ID, "mcp", "running", MCP_EVENT_ARGS)),
          step.event(ev.toolCall(CALL_ID, "mcp", "completed", MCP_EVENT_ARGS, MCP_RESULT)),
          step.event(ev.assistant(TEXT_AFTER)),
          step.turnEnded({ inputTokens: 2_100, outputTokens: 80, cacheReadTokens: 0, cacheWriteTokens: 0 }),
          step.finished({ result: TEXT_AFTER, model: { id: FIXTURE.model, params: [] } }),
        ],
      ],
    });
    const record = cursorExecutionRecord({ message: USER_MESSAGE });
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
    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("EXECUTION_COMPLETED");
    expect(record.persistedPhases.at(-1)).toBe(ExecutionPhase.EXECUTION_COMPLETED);

    // ── Assert: the attributed row ───────────────────────────────────────────
    const rows = record.toolCalls();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.id).toBe(CALL_ID);
    expect(row.name, "the inner tool, never the `mcp` envelope").toBe(MCP_TOOL);
    expect(row.mcpServerSlug).toBe(MCP_SERVER);
    expect(row.toolKind).toBe(ToolKind.MCP);
    expect(row.args, "the inner args").toEqual(INNER_ARGS);
    expect(row.argsPreview, "TODAY: the outer envelope stringified (the M4 hunk, Q-S4-16, makes it the inner args)").toBe(
      JSON.stringify(MCP_EVENT_ARGS),
    );
    expect(row.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(row.result).toBe(MCP_RESULT);
    expect(row.requiresApproval, "no server declared, no policy, not gated").toBe(false);

    // ── Assert: hermeticity ──────────────────────────────────────────────────
    expect(registry.urls.every((u) => u.includes("/model-registry"))).toBe(true);

    // ── Assert: the golden ───────────────────────────────────────────────────
    const final = record.lastFullStatus!;
    const json = JSON.stringify(toJson(AgentExecutionStatusSchema, final), null, 2) + "\n";
    await expect(json).toMatchFileSnapshot("./goldens/mcp-tool-call.status.json");
  });
});
