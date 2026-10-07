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
// One agent covers both lists: `tools` names the fixture's safe echo and
// Bash, `disallowed_tools` names Bash. The scripted turn calls echo (in
// scope), `execute` (Bash: allowed by `tools`, removed first by
// `disallowed_tools`) and the destructive echo (on an attached, connected
// server, but not named by `tools`). Both refused tools would otherwise ask
// for approval (a shell command; a tool its server marks destructive), so a
// refusal that leaked into the gate would park the run, which the poll below
// reports at once instead of waiting out a timeout.
//
// Deliberately out of scope, each pinned beside its code in the runner:
// sub-agent narrowing, `Agent(type, …)`, a `tools` list that resolves to
// nothing, the `.stigmer/` read that survives a list without Read, and the
// Cursor engine (the gateway contract, approval-gateway-contract.test.ts,
// runs the lists on both engines).
import { ApprovalEventType, RunPhase, ToolCallStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { DESTRUCTIVE_ECHO_TOOL_NAME, ECHO_TOOL_NAME, type McpToolFixture } from "../harness/mcp-server";
import { readAnthropicRequest } from "@stigmer/test-support/llm-wire";
import { anthropicText, anthropicToolUses, type MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { agentRefOf, makeAgent } from "../support/agents";
import {
  allToolCalls,
  createConnectedMcpServer,
  isTerminalPhase,
  makeAgentExecution,
  pollExecution,
  requireLlmProxy,
  requireMcpFixture,
} from "../support/agentruns";
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

describe("AgentRun tool lists — out of scope is refused, never gated", () => {
  it.each([
    { posture: "the approval default", autoApproveAll: false },
    { posture: "auto_approve_all", autoApproveAll: true },
  ])("under $posture, a call outside the lists fails with the out-of-scope message and requests no approval", async ({ autoApproveAll }) => {
    const { org } = await target.provisionTenancy();
    const server = await createConnectedMcpServer(clients, mcp, fixtures, {
      org,
      name: uniqueName("mcp-lists"),
      tools: [ECHO_TOOL_NAME, DESTRUCTIVE_ECHO_TOOL_NAME],
    });
    const slug = server.metadata!.slug;
    const agent = await clients.agentCommand.create(
      makeAgent({
        org,
        name: uniqueName("agent-lists"),
        mcpServerRefs: [slug],
        tools: [`mcp__${slug}__${ECHO_TOOL_NAME}`, "Bash"],
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
