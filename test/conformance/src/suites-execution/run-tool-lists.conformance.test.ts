// Conformance suite for an agent's two tool lists on the native engine (Class B).
// Domain: agentic / agentexecution — AgentSpec.tools ("only these") and
// AgentSpec.disallowed_tools ("never these"), read through execution status.
//
// The contract under test (agent/v1/spec.proto, the runner's
// shared/tool-lists.ts): `disallowed_tools` applies first, then `tools`
// against what remains, and a tool outside the result is out of the agent's
// reach. Out of reach means three observable things, and the suite pins each:
//   - the model is never offered the tool (the first model request's tool
//     surface leaves it out);
//   - a call the model makes anyway is a failed tool call carrying the
//     out-of-scope message, which the model reads on its next request, and
//     the tool never runs (the MCP fixture sees no call for it);
//   - no approval is ever requested for it, under the default and under
//     auto_approve_all alike: a list is not a gate, and "approve everything"
//     does not widen it.
// One agent covers both lists: `tools` names the fixture's safe echo (by
// its plugin server's name, `mcp__plugin_<plugin>_<server>__echo`) and Bash,
// `disallowed_tools` names Bash. The scripted turn calls echo (in scope),
// `execute` (Bash: allowed by `tools`, removed first by `disallowed_tools`)
// and the destructive echo (on a listed plugin's server, but not named by
// `tools`). Both refused tools would otherwise ask for approval (a shell
// command; a tool its server marks destructive), so a refusal that leaked
// into the gate would park the run, which the poll below reports at once
// instead of waiting out a timeout.
//
// A plugin's own agent is scoped by its own list the same way: a listed
// plugin's agent runs as the sub-agent `<plugin>:<agent>`, and its `tools`
// list, written in Claude Code's names for the plugin's server, offers it
// exactly what it names. The arm uses a plugin whose name holds a `.` and a
// server whose name holds `_`, so the segment the list names
// (`plugin_<plugin>_<server>`, every character outside `A-Za-z0-9_-` as
// `_`) carries `_` inside both names and is still told apart from the tool.
// A plugin's own name cannot hold `_` (the plugin library admits lowercase
// letters, digits, `-` and `.`), so the server name carries it.
//
// Deliberately out of scope, each pinned beside its code in the runner:
// an agent's own sub-agent narrowing, `Agent(type, …)`, a `tools` list that
// resolves to nothing, the `.stigmer/` read that survives a list without
// Read, and the Cursor engine (the gateway contract,
// approval-gateway-contract.test.ts, runs the lists on both engines).
import {
  ApprovalEventType,
  RunPhase,
  SubAgentStatus,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { DESTRUCTIVE_ECHO_TOOL_NAME, ECHO_TOOL_NAME, FAIL_TOOL_NAME, type McpToolFixture } from "../harness/mcp-server";
import { readAnthropicRequest } from "@stigmer/test-support/llm-wire";
import { anthropicText, anthropicToolUse, anthropicToolUses, type MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { agentRefOf, makeAgent } from "../support/agents";
import {
  allToolCalls,
  awaitTerminal,
  isTerminalPhase,
  makeAgentExecution,
  pollExecution,
  pushFixturePlugin,
  requireLlmProxy,
  requireMcpFixture,
} from "../support/runs";
import { FIXTURE_SERVER, oneServerPlugin, pluginToolName, pushPlugin } from "../support/plugins";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

// The native engine's shell tool, which Claude's `Bash` names.
const NATIVE_SHELL_TOOL = "execute";

// The words every out-of-scope refusal carries after the tool's name (the
// runner's shared/tool-lists.ts outOfScopeMessage); this package cannot
// import the runner.
const OUT_OF_SCOPE = "is not available to this agent";

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
  mcp.resetCaptured();
});

afterAll(async () => {
  await target?.teardown();
});

describe("Run tool lists — out of scope is refused, never gated", () => {
  it.each([
    { posture: "the approval default", autoApproveAll: false },
    { posture: "auto_approve_all", autoApproveAll: true },
  ])("under $posture, a call outside the lists fails with the out-of-scope message and requests no approval", async ({ autoApproveAll }) => {
    const { org } = await target.provisionTenancy();
    const plugin = await pushFixturePlugin(clients, mcp, fixtures, {
      org,
      name: uniqueName("lists"),
      tools: [ECHO_TOOL_NAME, DESTRUCTIVE_ECHO_TOOL_NAME],
    });
    const agent = await clients.agentCommand.create(
      makeAgent({
        org,
        name: uniqueName("agent-lists"),
        plugins: [plugin.metadata!.slug],
        tools: [pluginToolName(plugin.metadata!.name, FIXTURE_SERVER, ECHO_TOOL_NAME), "Bash"],
        disallowedTools: ["Bash"],
      }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

    mock.enqueue(
      anthropicToolUses([
        { toolCallId: "call_in_scope", toolName: ECHO_TOOL_NAME, toolInput: { text: "in scope" } },
        { toolCallId: "call_denied_shell", toolName: NATIVE_SHELL_TOOL, toolInput: { command: "echo denied" } },
        { toolCallId: "call_unlisted", toolName: DESTRUCTIVE_ECHO_TOOL_NAME, toolInput: { text: "unlisted" } },
      ]),
    );
    mock.enqueue(anthropicText("Done."));

    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-lists"), agentRef: agentRefOf(agent), autoApproveAll }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    // Terminal, or parked at a gate: a refusal that reached the approval gate
    // is red here, naming the phase, rather than as a timeout.
    const settled = await pollExecution(
      clients,
      executionId,
      (e) => isTerminalPhase(e.status?.phase) || e.status?.phase === RunPhase.RUN_WAITING_FOR_APPROVAL,
      { label: "a terminal phase or an approval gate" },
    );
    expect(
      RunPhase[settled.status?.phase ?? 0],
      `execution ${executionId} completes without a gate (error: ${settled.status?.error ?? ""})`,
    ).toBe(RunPhase[RunPhase.RUN_COMPLETED]);
    expect(settled.status?.pendingApprovals ?? [], "no approval is pending").toEqual([]);
    expect(
      (settled.status?.approvalEventStream?.events ?? []).filter((e) => e.eventType === ApprovalEventType.REQUESTED),
      "no approval was ever requested",
    ).toEqual([]);

    // Hidden: the model was never offered either refused tool.
    const scripted = mock.scriptedRequests();
    expect(scripted.length, "the tool round and the answer").toBe(2);
    const offered = (readAnthropicRequest(scripted[0]!.body).tools ?? []).map((t) => t.name);
    expect(offered, "the in-scope tool is offered").toContain(ECHO_TOOL_NAME);
    expect(offered, "a tool disallowed_tools removes is not offered").not.toContain(NATIVE_SHELL_TOOL);
    expect(offered, "a tool tools does not name is not offered").not.toContain(DESTRUCTIVE_ECHO_TOOL_NAME);

    // Refused: the model reads each refusal on its next request, and the
    // refused tools never ran (the fixture saw exactly the one in-scope call).
    const nextRequest = JSON.stringify(scripted[1]!.body);
    expect(nextRequest, "the model reads the shell refusal").toContain(`${NATIVE_SHELL_TOOL} ${OUT_OF_SCOPE}`);
    expect(nextRequest, "the model reads the unlisted tool's refusal").toContain(`${DESTRUCTIVE_ECHO_TOOL_NAME} ${OUT_OF_SCOPE}`);

    expect(
      mcp.capturedRequests().filter((request) => request.method === "tools/call"),
      "only the in-scope call reached the MCP server",
    ).toHaveLength(1);

    // On the transcript: each out-of-scope call is a failed tool call
    // carrying the message; the in-scope call ran.
    const calls = allToolCalls(settled);
    const byName = (name: string) => calls.find((tc) => tc.name === name);
    const inScope = byName(ECHO_TOOL_NAME);
    expect(inScope, "the in-scope echo is on the transcript").toBeDefined();
    expect(ToolCallStatus[inScope!.status], "the in-scope echo ran").toBe(ToolCallStatus[ToolCallStatus.TOOL_CALL_COMPLETED]);
    expect(inScope!.result).toContain("in scope");
    for (const name of [NATIVE_SHELL_TOOL, DESTRUCTIVE_ECHO_TOOL_NAME]) {
      const refused = byName(name);
      expect(
        refused,
        `the refused ${name} call is on the transcript (calls: ${calls.map((tc) => `${tc.name}:${ToolCallStatus[tc.status]}`).join(", ")})`,
      ).toBeDefined();
      expect(ToolCallStatus[refused!.status], `${name} is a failed tool call`).toBe(ToolCallStatus[ToolCallStatus.TOOL_CALL_FAILED]);
      expect(refused!.error, `${name} carries the out-of-scope message`).toContain(`${name} ${OUT_OF_SCOPE}`);
    }
  });
});

// The built-in delegation tool the native engine binds when the turn has
// sub-agents (a listed plugin's agents among them).
const TASK_TOOL_NAME = "task";

describe("Run tool lists — a plugin's agent is scoped by its own list", () => {
  it("the sub-agent <plugin>:<agent> is offered and runs what its list names on the plugin's server, and a call outside it fails with the out-of-scope message", async () => {
    const { org } = await target.provisionTenancy();
    // A `.` in the plugin's name and a `_` in the server's: the segment the
    // list names is `plugin_acme_desk-<id>_order_desk`.
    const pluginName = uniqueName("acme.desk");
    const serverName = "order_desk";
    const inScope = pluginToolName(pluginName, serverName, ECHO_TOOL_NAME);
    expect(inScope).toMatch(/^mcp__plugin_acme_desk-[0-9a-f]{8}_order_desk__echo$/);
    const plugin = await pushPlugin(
      clients,
      fixtures,
      org,
      oneServerPlugin({
        name: pluginName,
        serverName,
        server: { url: mcp.url([ECHO_TOOL_NAME, FAIL_TOOL_NAME]) },
        agents: [
          {
            file: "clerk",
            frontmatter: { description: "Looks orders up at the desk.", tools: [inScope] },
            body: "You look orders up with the desk's echo tool and report what it answers.",
          },
        ],
      }),
    );
    expect(plugin.status?.agents.map((a) => [a.name, a.tools]), "the agent's list is kept as written").toEqual([
      ["clerk", [inScope]],
    ]);
    const subAgent = `${pluginName}:clerk`;

    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("agent-desk"), plugins: [plugin.metadata!.slug] }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

    // Parent delegates; the child calls echo (named by its list) and fail (on
    // the same server, not named), then answers; the parent answers.
    mock.enqueue(
      anthropicToolUse("toolu_desk_task", TASK_TOOL_NAME, {
        description: "Look the order up",
        prompt: "Echo the order id back.",
        subagent_type: subAgent,
      }),
    );
    mock.enqueue(
      anthropicToolUses([
        { toolCallId: "call_desk_echo", toolName: ECHO_TOOL_NAME, toolInput: { text: "ORD-4821" } },
        { toolCallId: "call_desk_fail", toolName: FAIL_TOOL_NAME, toolInput: { message: "unlisted" } },
      ]),
    );
    mock.enqueue(anthropicText("The desk answered ORD-4821."));
    mock.enqueue(anthropicText("The clerk found ORD-4821."));

    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-desk"), agentRef: agentRefOf(agent) }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    const final = await awaitTerminal(clients, executionId);
    expect(
      RunPhase[final.status?.phase ?? 0],
      `execution ${executionId} completes (error: ${final.status?.error ?? ""})`,
    ).toBe(RunPhase[RunPhase.RUN_COMPLETED]);
    expect(mock.remaining(), "parent, child, child, parent: every scripted turn was consumed").toBe(0);

    const child = (final.status?.subAgentRuns ?? []).find((run) => run.name === subAgent);
    expect(child, `the plugin's agent ran as ${subAgent}`).toBeDefined();
    expect(SubAgentStatus[child!.status]).toBe(SubAgentStatus[SubAgentStatus.SUB_AGENT_COMPLETED]);

    // Offered: the child's first request carries the named tool and not the other.
    const childRequest = mock.scriptedRequests()[1];
    expect(childRequest, "the child's first model request").toBeDefined();
    const offered = (readAnthropicRequest(childRequest!.body).tools ?? []).map((t) => t.name);
    expect(offered, "the tool its list names is offered").toContain(ECHO_TOOL_NAME);
    expect(offered, "a tool its list does not name is not offered").not.toContain(FAIL_TOOL_NAME);

    const calls = allToolCalls(final);
    const echo = calls.find((tc) => tc.id === "call_desk_echo");
    expect(ToolCallStatus[echo?.status ?? 0], "the named tool ran").toBe(ToolCallStatus[ToolCallStatus.TOOL_CALL_COMPLETED]);
    expect(echo!.result).toContain("ORD-4821");
    const refused = calls.find((tc) => tc.id === "call_desk_fail");
    expect(ToolCallStatus[refused?.status ?? 0], "the unnamed tool is a failed call").toBe(
      ToolCallStatus[ToolCallStatus.TOOL_CALL_FAILED],
    );
    expect(refused!.error).toContain(`${FAIL_TOOL_NAME} ${OUT_OF_SCOPE}`);
    expect(
      mcp.capturedRequests().filter((request) => request.method === "tools/call"),
      "only the named call reached the server",
    ).toHaveLength(1);
  });
});
