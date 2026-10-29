// Conformance suite for a turn's transcript: what the session's log says of
// a completed run for a plain text turn, a thinking turn, and MCP tool calls
// that succeed or fail — plus the model id the provider actually received.
// Domain: agentic / agentexecution and session — the transcript a console or
// SDK renders, folded from the session's events (support/turn.ts).
//
// These are runner behaviors read through the session's log, and so contract;
// they replace the Go offline suite's offline_test.go,
// plain_chat_offline_test.go and the agent half of
// model_resolution_offline_test.go. The MCP echo round-trip itself is the harness
// smoke (mcp.harness.test.ts); this file asserts what the transcript
// says about it and about a tool that fails.
//
// Two contracts here are easy to get wrong and are stated on purpose:
// - A failing MCP tool is a TOOL RESULT, not a failed run. The tool use and
//   its result are in the log, the agent gets its next turn, the run completes.
// - The model id on the wire is the registry's apiModelId, not the registry id
//   the execution named. The runner resolves it through the control plane's
//   /v1/proxy/model-registry; this arm reads the same document the
//   runner did (target.modelRegistryDocument()) and asserts the resolved id
//   reached the mock — a runner that stops resolving fails here on either
//   edition. The two ids must differ, or the arm would pass on the identity
//   fallback it exists to catch.
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { ECHO_TOOL_NAME, FAIL_TOOL_NAME, type FixtureTool, type McpToolFixture, mcpToolName } from "../harness/mcp-server";
import type { AnthropicMessageBody, MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
import { requireRegistryRow } from "../harness/model-registry";
import { agentRefOf, makeAgent } from "../support/agents";
import { messagesOf, toolUsesOf, turnOfRun } from "../support/turn";
import {
  awaitTerminal,
  makeAgentExecution,
  requireLlmProxy,
  requireMcpFixture,
  pushFixturePlugin,
} from "../support/runs";
import { toolServerSegment } from "../support/plugins";
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
  // The name of the plugin carrying the surface; defaults to a unique one.
  pluginName?: string;
  modelName?: string;
  message?: string;
}): Promise<Run> {
  const { org } = await target.provisionTenancy();
  const plugins: string[] = [];
  if (opts.tools !== undefined) {
    const plugin = await pushFixturePlugin(clients, mcp, fixtures, {
      org,
      name: opts.pluginName ?? uniqueName("messages"),
      tools: opts.tools,
    });
    plugins.push(plugin.metadata!.slug);
  }
  const agent = await clients.agentCommand.create(
    makeAgent({ org, name: uniqueName("agent-messages"), plugins }),
  );
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({
      org,
      name: uniqueName("aex-messages"),
      agentRef: agentRefOf(agent),
      message: opts.message,
      autoApproveAll: true,
      ...(opts.modelName !== undefined ? { runConfig: { modelName: opts.modelName } } : {}),
    }),
  );
  const executionId = execution.metadata!.id;
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));
  return awaitTerminal(clients, executionId);
}

function expectCompleted(final: Run): void {
  expect(
    final.status?.phase,
    `execution ${final.metadata?.id} should complete; reached ${RunPhase[final.status?.phase ?? 0]} ` +
      `(status.error: ${JSON.stringify(final.status?.error ?? "")})`,
  ).toBe(RunPhase.RUN_COMPLETED);
}

describe("Run messages — text and thinking turns", () => {
  it("a single text turn completes with one stored agent message and no tool uses", async () => {
    mock.enqueue(anthropicText("Hello from the mock."));

    const final = await runAgent({});

    expectCompleted(final);
    const turn = await turnOfRun(clients, final);
    const messages = messagesOf(turn);
    expect(messages, "exactly the one agent message is in the log").toHaveLength(1);
    expect(messages[0]!.text).toBe("Hello from the mock.");
    expect(messages[0]!.live, "a stored message is not a live preview").toBe(false);
    expect(turn.answer).toBe("Hello from the mock.");
    expect(toolUsesOf(turn)).toHaveLength(0);
    expect(mock.consumed()).toBe(1);
  });

  it("a thinking block surfaces as agent thinking beside the agent's answer", async () => {
    mock.enqueue(anthropicThinkingThenText("Let me consider the question carefully.", "The answer is 42."));

    const final = await runAgent({});

    expectCompleted(final);
    const turn = await turnOfRun(clients, final);
    const thinking = turn.items.filter((item) => item.kind === "thinking");
    expect(thinking, "the thinking block is its own item").toHaveLength(1);
    expect(thinking[0]!.kind === "thinking" && thinking[0]!.text).toContain("consider the question");
    const messages = messagesOf(turn);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.text).toBe("The answer is 42.");
    expect(toolUsesOf(turn)).toHaveLength(0);
  });
});

describe("Run messages — MCP tool calls", () => {
  it("a failing MCP tool does not fail the run: the fail tool use and its result are in the log and the run completes", async () => {
    const pluginName = uniqueName("messages");
    mock.enqueue(anthropicToolUse("call_fail_1", mcpToolName(toolServerSegment(pluginName), FAIL_TOOL_NAME), { message: "deliberate" }));
    mock.enqueue(anthropicText("The tool reported an error; moving on."));

    const final = await runAgent({ tools: [ECHO_TOOL_NAME, FAIL_TOOL_NAME], pluginName });

    expectCompleted(final);
    const failCall = toolUsesOf(await turnOfRun(clients, final)).find((use) => use.name === FAIL_TOOL_NAME);
    expect(failCall, "the failed tool use is in the log").toBeDefined();
    // The runner records a tool's failure as an error result when the tool
    // node threw, or as a plain result carrying the tool's error content —
    // and either way the text the tool reported is what the log keeps.
    expect(["completed", "failed"], "the call settled").toContain(failCall!.state);
    expect(
      failCall!.result?.text ?? "",
      `the tool's message is on the result (${JSON.stringify(failCall!.result)})`,
    ).toContain("deliberate");
    expect(mock.consumed(), "the agent got its turn after the failure").toBe(2);
  });

  it("a tool use carries its id, name, input, result and MCP server", async () => {
    const pluginName = uniqueName("fields");
    mock.enqueue(anthropicToolUse("call_echo_fields", mcpToolName(toolServerSegment(pluginName), ECHO_TOOL_NAME), { text: "fields" }));
    mock.enqueue(anthropicText("Done."));

    const final = await runAgent({ tools: [ECHO_TOOL_NAME], pluginName });

    expectCompleted(final);
    const echo = toolUsesOf(await turnOfRun(clients, final)).find((use) => use.name === ECHO_TOOL_NAME);
    expect(echo).toBeDefined();
    expect(echo!.id, "the tool use is named for the call").toBe(`${final.metadata!.id}.call_echo_fields`);
    expect(echo!.state).toBe("completed");
    expect(echo!.input).toEqual({ text: "fields" });
    expect(echo!.processedAt, "the tool use is stamped when it was appended").not.toBe("");
    expect(echo!.result?.processedAt, "and so is its result").not.toBe("");
    expect(echo!.result?.text, "the echo result carries the input back").toContain("fields");
    expect(echo!.mcpServerName, "the call names the plugin server it ran on").toBe(toolServerSegment(pluginName));
  });
});

describe("Run messages — model resolution", () => {
  it("a registry id in run_config.model_name reaches the provider as the registry's apiModelId", async () => {
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
