// Conformance suite for the runner's advisories to the model (Class B).
// Domain: agentic / agentexecution — how the native harness warns the model
// mid-run, read at the one place it is observable: the requests the mock
// provider captured (test/support/src/mock-llm.ts), "everything the model
// received over the wire".
//
// The contract under test (stigmer/stigmer#1354): when the runner advises the
// model (loop detection's warning after repeated identical tool calls; the
// tool-round budget's at 80% of max_tool_rounds; the cost advisory's at 80%
// of max_cost_usd), the advisory reaches the provider as a request it
// accepts. Concretely, on the wire:
// - no request carries a system role among its messages (the system prompt
//   is the request's own field, and Anthropic refuses a system message
//   anywhere else);
// - every assistant turn that calls a tool is answered by the next user turn,
//   which holds only tool_result blocks;
// - the advisory is a text-only user turn after those results, on the one
//   request after the warning fires, and the run goes on.
// Until #1354 each advisory was a mid-conversation system message, and every
// Anthropic run that reached one failed its next model call.
//
// The arm here is loop detection's, the threshold the runner fixes at seven
// identical calls (runner execute-deep-agent/turn-setup.ts). The budget's
// advisory is proven end to end by the tool-round facet, whose run passes it
// on the way to its limit (agentexecution-tool-rounds.conformance.test.ts).
// The cost advisory is proven in the runner's hermetic net, with a price it
// controls (hermetic/cost-advisory.test.ts); this suite cannot see a model's
// price, so its token counts would be guesses.
//
// Deliberately out of scope: the advisories' wording (behaviour tuning,
// asserted nowhere on the wire), the Cursor harness (it carries none of these
// middlewares), and which threshold fires when (pinned beside each middleware
// in the runner's unit suites).
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { McpToolFixture } from "../harness/mcp-server";
import { ECHO_TOOL_NAME } from "../harness/mcp-server";
import { readTurnShapes, type TurnShape } from "@stigmer/test-support/llm-wire";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
import { makeAgent } from "../support/agents";
import { awaitTerminal, makeAgentExecution, requireLlmProxy, requireMcpFixture } from "../support/agentexecutions";
import { makeHttpMcpServer } from "../support/mcpservers";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

// Loop detection's consecutive threshold (runner turn-setup.ts): the seventh
// identical call sets the warning, and the eighth request carries it.
const IDENTICAL_CALLS = 7;

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

// The provider's ordering rules over one request's turns, asserted with the
// request's index in every message.
function expectProviderOrder(turns: TurnShape[], request: number): void {
  expect(
    turns.map((turn) => turn.role),
    `request ${request}: no system role among the messages`,
  ).not.toContain("system");
  turns.forEach((turn, index) => {
    if (turn.role !== "assistant" || !turn.blocks.includes("tool_use")) return;
    const next = turns[index + 1];
    expect(next?.role, `request ${request}: the tool call at ${index} is answered by the next turn`).toBe("user");
    expect(
      next?.blocks.every((block) => block === "tool_result"),
      `request ${request}: the answering turn at ${index + 1} holds only tool results`,
    ).toBe(true);
  });
}

function isTextOnlyUserTurn(turn: TurnShape | undefined): boolean {
  return turn?.role === "user" && turn.blocks.length > 0 && turn.blocks.every((block) => block === "text");
}

describe("AgentExecution advisories to the model", () => {
  it("loop detection's warning reaches the model as a user turn after the tool results, and the run completes", async () => {
    const { org } = await target.provisionTenancy();

    const server = await clients.mcpServerCommand.create(
      makeHttpMcpServer({ org, name: uniqueName("mcp-advisory"), url: mcp.url() }),
    );
    fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));

    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("agent-advisory"), mcpServerRefs: [server.metadata!.slug] }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

    // The same arguments every time: the repetition loop detection exists for.
    for (let call = 1; call <= IDENTICAL_CALLS; call++) {
      mock.enqueue(anthropicToolUse(`call_loop_${call}`, ECHO_TOOL_NAME, { text: "the same thing" }));
    }
    mock.enqueue(anthropicText("Done."));

    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("aex-advisory"),
        agentId: agent.metadata!.id,
        message: "Echo until you are done.",
        autoApproveAll: true,
      }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    const final = await awaitTerminal(clients, executionId);
    expect(
      final.status?.phase,
      `execution ${executionId} should COMPLETE past the warning; reached ${ExecutionPhase[final.status?.phase ?? 0]} (error: ${final.status?.error ?? ""})`,
    ).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    expect(
      mcp.capturedRequests().filter((request) => request.method === "tools/call"),
      `execution ${executionId}: every scripted call reached the tool`,
    ).toHaveLength(IDENTICAL_CALLS);

    const requests = mock.scriptedRequests();
    expect(requests, `execution ${executionId}: one request per scripted turn`).toHaveLength(IDENTICAL_CALLS + 1);
    const shapes = requests.map((request) => readTurnShapes(request.body));
    shapes.forEach((turns, index) => expectProviderOrder(turns, index));

    const advised = shapes.flatMap((turns, index) => {
      const last = turns.at(-1);
      const beforeLast = turns.at(-2);
      return isTextOnlyUserTurn(last) && beforeLast?.blocks.every((block) => block === "tool_result") ? [index] : [];
    });
    expect(advised, `execution ${executionId}: the advisory rides the one request after the seventh call`).toEqual([
      IDENTICAL_CALLS,
    ]);
  });
});
