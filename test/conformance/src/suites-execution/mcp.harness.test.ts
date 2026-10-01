// Execution-engine harness smoke test for the MCP tool fixture (Class B).
// Domain: agentic / agentexecution — proves the tool surface is wired, not the
// HITL contract (that lives in agentexecution-approval.conformance.test.ts).
//
// This is the cheap, permanent guard that the local-execution target's MCP
// machinery works end-to-end: an HTTP McpServer is registered (create only — no
// connect/discovery), an agent references it, and a real agent run dispatches the
// fixture's `echo` tool live. Approval is bypassed here (auto_approve_all) so the
// path under test is purely connect-live -> list-tools -> dispatch -> result;
// the approval dance is a separate suite.
//
// If this is green, the deep-pass design holds: the runner reaches the tool
// fixture and runs a tool without any discovery step. If it is red, stop and
// confer before building the approval suite on top of it.
import { ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { McpToolFixture } from "../harness/mcp-server";
import { ECHO_TOOL_NAME } from "../harness/mcp-server";
import type { MockLlmProxy } from "../harness/mock-llm";
import { anthropicText, anthropicToolUse } from "../harness/mock-llm";
import { makeAgent } from "../support/agents";
import {
  awaitTerminal,
  makeAgentExecution,
  requireLlmProxy,
  requireMcpFixture,
} from "../support/agentexecutions";
import { makeHttpMcpServer } from "../support/mcpservers";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
let mcp: McpToolFixture;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
  mcp = requireMcpFixture(target);
});

afterEach(async () => {
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

describe("Execution harness smoke — MCP tool dispatch", () => {
  it("runs an agent that calls a live MCP tool (no connect/discovery), reaching COMPLETED", async () => {
    const { org } = await target.provisionTenancy();

    // Register the in-process HTTP MCP fixture. Create only — the runner connects
    // to its url() live at execution setup.
    const server = await clients.mcpServerCommand.create(
      makeHttpMcpServer({ org, name: uniqueName("mcp"), url: mcp.url() }),
    );
    fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));
    const slug = server.metadata!.slug;

    // An agent that uses the MCP server, so the runner binds its `echo` tool.
    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("agent-mcp-smoke"), mcpServerRefs: [slug] }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

    // Script: call echo, then end the loop with a text turn. Approval is bypassed
    // (auto_approve_all), so echo runs immediately.
    mock.enqueue(anthropicToolUse("call_echo_smoke", ECHO_TOOL_NAME, { text: "ping" }));
    mock.enqueue(anthropicText("Done."));

    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("aex-mcp-smoke"),
        agentId: agent.metadata!.id,
        autoApproveAll: true,
      }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    const final = await awaitTerminal(clients, executionId);
    expect(
      final.status?.phase,
      `execution ${executionId} should complete; reached ${ExecutionPhase[final.status?.phase ?? 0]}`,
    ).toBe(ExecutionPhase.EXECUTION_COMPLETED);

    // The echo tool actually ran: a completed tool call named `echo` is recorded.
    const toolCalls = (final.status?.messages ?? []).flatMap((m) => m.toolCalls);
    const echo = toolCalls.find((tc) => tc.name === ECHO_TOOL_NAME);
    expect(echo, "an echo tool call should be recorded in status.messages").toBeTruthy();
    expect(echo?.status, "the echo tool call should be COMPLETED").toBe(ToolCallStatus.TOOL_CALL_COMPLETED);

    // The agent loop consumed exactly its two scripted turns.
    expect(mock.remaining(), "both queued turns were consumed").toBe(0);
    expect(mock.consumed(), "exactly two LLM turns were served").toBe(2);
  });
});
