// Conformance suite for the AgentExecution messages read model: what a
// completed run's status.messages carries for a plain text turn, a thinking
// turn, and MCP tool calls that succeed or fail — plus the model id the
// provider actually received.
// Domain: agentic / agentexecution — the transcript a console or SDK renders.
//
// These are runner behaviors read through execution status, contract by
// DD-001 (entry 20260910.02); they replace the Go offline suite's
// offline_test.go, plain_chat_offline_test.go and the agent half of
// model_resolution_offline_test.go (the accounting is the entry's
// T01_1_arm-disposition.md). The MCP echo round-trip itself is the harness
// smoke (mcp.harness.smoke.test.ts); this file asserts what the transcript
// says about it and about a tool that fails.
//
// Two contracts here are easy to get wrong and are stated on purpose:
// - A failing MCP tool is a TOOL RESULT, not a failed run. The ToolCall is
//   recorded, the agent gets its next turn, the run completes.
// - The model id on the wire is the registry's apiModelId, not the registry id
//   the execution named. The runner resolves it through the control plane's
//   /v1/proxy/model-registry (DD-002); this arm reads the same document the
//   runner did (target.modelRegistryDocument()) and asserts the resolved id
//   reached the mock — a runner that stops resolving fails here on either
//   edition. The two ids must differ, or the arm would pass on the identity
//   fallback it exists to catch.
import { MessageType, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { ECHO_TOOL_NAME, FAIL_TOOL_NAME, type FixtureTool, type McpToolFixture } from "../harness/mcp-server";
import type { AnthropicMessageBody, MockLlmProxy } from "../harness/mock-llm";
import { anthropicText, anthropicToolUse } from "../harness/mock-llm";
import { requireRegistryRow } from "../harness/model-registry";
import { makeAgent } from "../support/agents";
import {
  allToolCalls,
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

// A registry id the bundled registry maps to a DIFFERENT provider api id
// (claude-haiku-4.5 -> claude-haiku-4-5-20251001 at the time of writing; the
// arm reads the current mapping rather than pinning it).
const RESOLVABLE_REGISTRY_ID = "claude-haiku-4.5";

// A thinking turn: the Anthropic `thinking` block ahead of the answer, the
// shape extended-thinking models stream.
function anthropicThinkingThenText(thinking: string, text: string): AnthropicMessageBody {
  const body = anthropicText(text);
  return { ...body, content: [{ type: "thinking", thinking }, ...body.content] };
}

// Provisions an agent bound to the fixture surface `tools` names (echo only by
// default) and runs one execution with the queued script to a terminal phase.
async function runAgent(opts: {
  tools?: readonly FixtureTool[];
  modelName?: string;
  message?: string;
}): Promise<AgentExecution> {
  const { org } = await target.provisionTenancy();
  let mcpServerRefs: string[] = [];
  if (opts.tools !== undefined) {
    const server = await clients.mcpServerCommand.create(
      makeHttpMcpServer({ org, name: uniqueName("mcp"), url: mcp.url(opts.tools) }),
    );
    fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));
    mcpServerRefs = [server.metadata!.slug];
  }
  const agent = await clients.agentCommand.create(
    makeAgent({ org, name: uniqueName("agent-messages"), mcpServerRefs }),
  );
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({
      org,
      name: uniqueName("aex-messages"),
      agentId: agent.metadata!.id,
      message: opts.message,
      autoApproveAll: true,
      ...(opts.modelName !== undefined ? { executionConfig: { modelName: opts.modelName } } : {}),
    }),
  );
  const executionId = execution.metadata!.id;
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));
  return awaitTerminal(clients, executionId);
}

function expectCompleted(final: AgentExecution): void {
  expect(
    final.status?.phase,
    `execution ${final.metadata?.id} should complete; reached ${ExecutionPhase[final.status?.phase ?? 0]} ` +
      `(status.error: ${JSON.stringify(final.status?.error ?? "")})`,
  ).toBe(ExecutionPhase.EXECUTION_COMPLETED);
}

describe("AgentExecution messages — text and thinking turns", () => {
  it("a single text turn completes with one non-streaming AI message and no tool calls", async () => {
    mock.enqueue(anthropicText("Hello from the mock."));

    const final = await runAgent({});

    expectCompleted(final);
    const aiMessages = (final.status?.messages ?? []).filter((m) => m.type === MessageType.MESSAGE_AI);
    expect(aiMessages, "exactly the one assistant turn is in the transcript").toHaveLength(1);
    expect(aiMessages[0]!.content).toBe("Hello from the mock.");
    expect(aiMessages[0]!.isStreaming, "a settled message is not marked streaming").toBe(false);
    expect(allToolCalls(final)).toHaveLength(0);
    expect(mock.consumed()).toBe(1);
  });

  it("a thinking block surfaces as a MESSAGE_THINKING beside the MESSAGE_AI answer", async () => {
    mock.enqueue(anthropicThinkingThenText("Let me consider the question carefully.", "The answer is 42."));

    const final = await runAgent({});

    expectCompleted(final);
    const byType = (type: MessageType) => (final.status?.messages ?? []).filter((m) => m.type === type);
    const thinking = byType(MessageType.MESSAGE_THINKING);
    expect(thinking, "the thinking block is its own message").toHaveLength(1);
    expect(thinking[0]!.content).toContain("consider the question");
    const ai = byType(MessageType.MESSAGE_AI);
    expect(ai).toHaveLength(1);
    expect(ai[0]!.content).toBe("The answer is 42.");
    expect(allToolCalls(final)).toHaveLength(0);
  });
});

describe("AgentExecution messages — MCP tool calls", () => {
  it("a failing MCP tool does not fail the run: the fail ToolCall is recorded and the run completes", async () => {
    mock.enqueue(anthropicToolUse("call_fail_1", FAIL_TOOL_NAME, { message: "deliberate" }));
    mock.enqueue(anthropicText("The tool reported an error; moving on."));

    const final = await runAgent({ tools: [ECHO_TOOL_NAME, FAIL_TOOL_NAME] });

    expectCompleted(final);
    const failCall = allToolCalls(final).find((tc) => tc.name === FAIL_TOOL_NAME);
    expect(failCall, "the failed tool call is in the transcript").toBeDefined();
    // The runner records a tool's failure on the call — as a FAILED status with
    // the message on `error` when the tool node threw, or as a COMPLETED call
    // whose result carries the tool's error content — and either way the text
    // the tool reported is what the transcript keeps.
    expect(
      [ToolCallStatus.TOOL_CALL_COMPLETED, ToolCallStatus.TOOL_CALL_FAILED],
      "the call settled",
    ).toContain(failCall!.status);
    expect(
      `${failCall!.result} ${failCall!.error}`,
      `the tool's message is on the call (result=${JSON.stringify(failCall!.result)}, error=${JSON.stringify(failCall!.error)})`,
    ).toContain("deliberate");
    expect(mock.consumed(), "the agent got its turn after the failure").toBe(2);
  });

  it("a ToolCall carries id, name, started_at, completed_at, result and mcp_server_slug", async () => {
    mock.enqueue(anthropicToolUse("call_echo_fields", ECHO_TOOL_NAME, { text: "fields" }));
    mock.enqueue(anthropicText("Done."));

    const final = await runAgent({ tools: [ECHO_TOOL_NAME] });

    expectCompleted(final);
    const echo = allToolCalls(final).find((tc) => tc.name === ECHO_TOOL_NAME);
    expect(echo).toBeDefined();
    expect(echo!.id).not.toBe("");
    expect(echo!.status).toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(echo!.startedAt, "started_at is stamped").not.toBe("");
    expect(echo!.completedAt, "completed_at is stamped").not.toBe("");
    expect(echo!.result, "the echo result carries the input back").toContain("fields");
    expect(echo!.mcpServerSlug, "the call names the McpServer it ran on").not.toBe("");
  });
});

describe("AgentExecution messages — model resolution", () => {
  it("a registry id in execution_config.model_name reaches the provider as the registry's apiModelId", async () => {
    if (target.modelRegistryDocument === undefined) {
      throw new Error(`target ${target.name} exposes no model registry document; execution targets must`);
    }
    const row = requireRegistryRow(await target.modelRegistryDocument(), RESOLVABLE_REGISTRY_ID);
    expect(row.apiModelId, `the registry must map ${RESOLVABLE_REGISTRY_ID} to a provider id`).toBeDefined();
    expect(row.apiModelId, "the arm is only meaningful when resolution changes the id").not.toBe(row.id);

    mock.enqueue(anthropicText("Resolved."));
    const final = await runAgent({ modelName: RESOLVABLE_REGISTRY_ID });

    expectCompleted(final);
    // requests() also carries the background session-titling call (#690),
    // which rides STIGMER_PRIMARY_MODEL — so the assertion is membership, not
    // equality: the agent turn's model is the resolved id, and the registry id
    // never reached the wire.
    const models = mock.requestModels();
    expect(models, "the agent turn's model is the resolved api id").toContain(row.apiModelId);
    expect(models, "the registry id itself never reached the provider").not.toContain(row.id);
  });
});
