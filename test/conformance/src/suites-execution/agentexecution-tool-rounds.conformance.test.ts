// Conformance suite for ExecutionConfig.max_tool_rounds (Class B).
// Domain: agentic / agentexecution — the round budget a run's tool use is held to.
//
// The contract under test (stigmer/stigmer#1463, spec.proto's max_tool_rounds):
// a run given a budget of N tool rounds makes exactly N, then ends
// EXECUTION_TERMINATED with the tool-call-limit copy, whose prefix is a
// cross-repository contract (the runner's shared/tool-rounds.ts). A round is
// one model response that proposes tools, so the budget is read in rounds
// executed: N tools/call requests at the MCP fixture and N tool rows on the
// persisted transcript, never N+1.
//
// The script holds more tool turns than the budget allows, each with distinct
// arguments: with exactly N scripted turns, the mock's 500 on the next request
// would end the run the same way, and repeated arguments would let loop
// detection stop it first. The unconsumed turns prove the stop was the budget.
//
// Deliberately out of scope: the Cursor harness (spec.proto: it does not
// enforce the field), parallel calls in one round, the clamp to the 10–1000
// range and loop detection, each pinned beside its code in the runner
// (recursion-limit.test.ts, execution-budget.test.ts, tool-rounds.test.ts,
// loop-detection.test.ts).
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { McpToolFixture } from "../harness/mcp-server";
import { ECHO_TOOL_NAME } from "../harness/mcp-server";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
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

// The smallest budget the runner accepts (tool-rounds.ts MIN_TOOL_ROUNDS);
// a lower value is clamped up to it, which this suite does not exercise.
const MAX_TOOL_ROUNDS = 10;

// One more tool turn than the budget allows, then a closing text turn: a run
// that ignored the budget would consume them all and COMPLETE.
const SCRIPTED_TOOL_TURNS = MAX_TOOL_ROUNDS + 1;

// The copy's leading words, pinned verbatim to TOOL_CALL_LIMIT_ERROR_PREFIX
// (the runner's shared/tool-rounds.ts); this package cannot import the runner.
const TOOL_CALL_LIMIT_PREFIX = "Agent reached the tool-call limit";

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

describe("AgentExecution execution_config.max_tool_rounds", () => {
  // The run passes its 80% advisory on the way to the limit, so this case is
  // also the end-to-end proof that the advisory reaches an Anthropic model as
  // a request it accepts (stigmer/stigmer#1354).
  it("[rpc:AgentExecutionCommandController.create] ends the run at its budget, with exactly that many tool rounds made", async () => {
    const { org } = await target.provisionTenancy();

    const server = await clients.mcpServerCommand.create(
      makeHttpMcpServer({ org, name: uniqueName("mcp-rounds"), url: mcp.url() }),
    );
    fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));

    const agent = await clients.agentCommand.create(
      makeAgent({ org, name: uniqueName("agent-rounds"), mcpServerRefs: [server.metadata!.slug] }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

    for (let round = 1; round <= SCRIPTED_TOOL_TURNS; round++) {
      mock.enqueue(anthropicToolUse(`call_round_${round}`, ECHO_TOOL_NAME, { text: `round-${round}` }));
    }
    mock.enqueue(anthropicText("Done."));

    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({
        org,
        name: uniqueName("aex-rounds"),
        agentId: agent.metadata!.id,
        message: "Echo each round.",
        autoApproveAll: true,
        executionConfig: { maxToolRounds: MAX_TOOL_ROUNDS },
      }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    const final = await awaitTerminal(clients, executionId);
    expect(
      final.status?.phase,
      `execution ${executionId} should be TERMINATED by its budget; reached ${ExecutionPhase[final.status?.phase ?? 0]} (error: ${final.status?.error ?? ""})`,
    ).toBe(ExecutionPhase.EXECUTION_TERMINATED);
    const error = final.status?.error ?? "";
    expect(
      error.startsWith(TOOL_CALL_LIMIT_PREFIX),
      `execution ${executionId}: the terminal copy starts with the cross-repo prefix; got "${error}"`,
    ).toBe(true);
    expect(error, `execution ${executionId}: the copy carries no internal event count`).not.toMatch(/\d+ events?/);
    expect(final.status?.completedAt, `execution ${executionId}: a budget stop is a finished run`).not.toBe("");

    expect(
      mcp.capturedRequests().filter((request) => request.method === "tools/call"),
      `execution ${executionId}: exactly ${MAX_TOOL_ROUNDS} rounds reached the tool`,
    ).toHaveLength(MAX_TOOL_ROUNDS);
    expect(
      allToolCalls(final),
      `execution ${executionId}: the transcript holds exactly ${MAX_TOOL_ROUNDS} tool rows`,
    ).toHaveLength(MAX_TOOL_ROUNDS);
    expect(mock.consumed(), `execution ${executionId}: the model was asked once per round, never again`).toBe(
      MAX_TOOL_ROUNDS,
    );
    expect(
      mock.remaining(),
      `execution ${executionId}: the turns past the budget were never requested`,
    ).toBe(SCRIPTED_TOOL_TURNS - MAX_TOOL_ROUNDS + 1);
  });
});
