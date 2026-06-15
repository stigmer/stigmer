// Local-only execution test for the Open Computer Use desktop-automation server.
// Domain: agentic / agentexecution — proves the seedpack's open-computer-use
// McpServer definition actually drives the GUI through the real runner stack
// (Temporal orchestrator + TS runner + stdio MCP subprocess + mock LLM).
//
// Why this is skip-gated rather than always-on:
// Open Computer Use controls the local desktop via macOS accessibility APIs. It
// only works when (a) the host is macOS and (b) the interactive session that
// launched the test has been granted Accessibility + Screen Recording. CI is
// headless linux, so this can never be a regression guard there — it is an
// opt-in developer gate, enabled with STIGMER_DESKTOP_TESTS=1 on a real desktop.
//
// What it asserts: scripting get_app_state("Finder") through the agent loop
// dispatches the stdio tool, relays its result — a text accessibility tree plus
// a base64 PNG screenshot (image content block) — back into the loop without
// crashing the pipeline, and reaches COMPLETED with the tool call recorded as
// COMPLETED. Finder is always running on macOS, so the action is deterministic.
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { MockLlmProxy } from "../harness/mock-llm";
import { anthropicText, anthropicToolUse } from "../harness/mock-llm";
import { makeAgent } from "../support/agents";
import { awaitTerminal, makeAgentExecution, requireLlmProxy } from "../support/agentexecutions";
import { makeMcpServer } from "../support/mcpservers";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

const ENABLED = process.platform === "darwin" && process.env.STIGMER_DESKTOP_TESTS === "1";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  if (!ENABLED) return;
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
});

afterEach(async () => {
  if (!ENABLED) return;
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  if (!ENABLED) return;
  await target?.teardown();
});

describe.skipIf(!ENABLED)("Open Computer Use — desktop tool dispatch (local-only)", () => {
  it("dispatches get_app_state(Finder) through the runner and reaches COMPLETED with the screenshot relayed", async () => {
    const { org } = await target.provisionTenancy();

    // The shipped seedpack invocation: a stdio subprocess launched via npx. The
    // runner spawns it live and speaks JSON-RPC over stdio — no connect/discovery.
    const server = await clients.mcpServerCommand.create(
      makeMcpServer({
        org,
        name: uniqueName("ocu"),
        command: "npx",
        args: ["-y", "@qwen-code/open-computer-use", "mcp"],
      }),
    );
    fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));
    const slug = server.metadata!.slug;

    const agent = await clients.agentCommand.create(
      makeAgent({
        org,
        name: uniqueName("agent-ocu"),
        instructions: "You operate the macOS desktop via the Computer Use tools.",
        mcpServerRefs: [slug],
      }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

    // Script: observe Finder, then end with a text turn. Approval is bypassed
    // (auto_approve_all) so the read-only observation runs immediately.
    mock.enqueue(anthropicToolUse("call_get_app_state", "get_app_state", { app: "Finder" }));
    mock.enqueue(anthropicText("Observed Finder."));

    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("aex-ocu"),
        agentId: agent.metadata!.id,
        autoApproveAll: true,
      }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    // Generous timeout: a cold npx may download the package on first run.
    const final = await awaitTerminal(clients, executionId, { timeoutMs: 180_000, pollMs: 1_000 });
    expect(
      final.status?.phase,
      `execution ${executionId} should COMPLETE; reached ${ExecutionPhase[final.status?.phase ?? 0]}`,
    ).toBe(ExecutionPhase.EXECUTION_COMPLETED);

    const toolCalls = (final.status?.messages ?? []).flatMap((m) => m.toolCalls);
    const call = toolCalls.find((tc) => tc.name === "get_app_state");
    expect(call, "a get_app_state tool call should be recorded in status.messages").toBeTruthy();
    expect(call?.status, "the get_app_state tool call should be COMPLETED").toBe(
      ToolCallStatus.TOOL_CALL_COMPLETED,
    );

    expect(mock.remaining(), "both scripted LLM turns were consumed").toBe(0);
    expect(mock.consumed(), "exactly two LLM turns were served").toBe(2);
  });
});
