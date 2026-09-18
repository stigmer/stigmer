// Conformance suite for the shape of the request the native harness sends the
// model: for a BARE agent (one instruction sentence; no skills, workspace
// entries, attachments, channel, sub-agents or standing context), the bytes
// the provider receives on the first model call, photographed as file
// goldens, and the facts about them that the platform's later work moves
// deliberately.
// Domain: agentic / agentexecution — the runner's outbound contract with the
// model, read at the one place it is observable offline: the mock proxy's
// captured request bodies (harness/mock-llm.ts), which are "everything the
// model received over the wire".
//
// Why this facet exists: the native harness's latency and output quality are
// a function of what the model is sent — how many bytes of prompt precede
// the user's message, which tools it may call and what their descriptions
// nudge it to do, whether extended thinking is on, and whether the prompt is
// byte-stable from one turn to the next so the provider's prefix cache can
// hold. Each of those is scheduled to change on purpose. Without a pinned
// "before", a change to any of them is invisible in review and unmeasurable
// after; with one, it is a hunk in a readable golden that the PR explains.
//
// What is pinned, and where each fact comes from:
// - The system prompt as the PROVIDER receives it: an array of text blocks,
//   not the runner's one string. The deepagents engine wraps the runner's
//   prompt (execute-deep-agent/prompt-builder.ts) as the first block and
//   appends its own base prompt and one block per prompt-bearing middleware
//   (todo list, filesystem with the execute section, sub-agent delegation),
//   then marks the LAST block with a prompt-cache breakpoint. The runner's
//   own golden (execute-deep-agent/__tests__/prompt-goldens.test.ts) pins the
//   first block alone; only the wire shows the rest, so this golden and that
//   one are two facts, not one fact twice.
// - The tool surface in wire order — name, description, input_schema. No
//   source file states it whole: deepagents binds its built-ins per backend
//   capability at call time and the runner's tool-intent middleware reshapes
//   the `execute` schema at the same hook. The golden is the only photograph.
//   The platform's memory-capture tool `remember` is NOT on a bare agent's
//   surface: recall is an organization preference that defaults off
//   (stigmer-server domain/agentexecution/create-steps.ts,
//   ComposeRecalledMemories), so the runner never synthesizes the attachment
//   for it. An org that turns memory on adds one stdio MCP tool served by the
//   `stigmer` command on PATH — a different photograph this facet does not
//   take.
// - The thinking posture: no `thinking` field and temperature 0 on today's
//   native request. Asserted as values, not a golden, so the change that
//   turns thinking on reads as a one-line hunk.
// - Byte-stability: a second turn in the same session sends `system` and
//   `tools` byte-identical to the first's when the standing facts have not
//   changed. The arm for an agent with many skills or a written file is
//   deliberately NOT here: today's contract for that case is "may vary", and
//   a conformance test asserts the intended contract, never the accident.
//
// The goldens depend on two things the header names so a moved golden is
// diagnosed, not guessed at: (1) the execution lane's model pin
// (harness/runner-process.ts STIGMER_PRIMARY_MODEL), because deepagents
// appends a per-model prompt suffix; (2) the pinned deepagents version, whose
// built-in prompt blocks and tool descriptions are part of the photograph on
// purpose — a dependency bump moves the golden, and the hunk is the review of
// what upstream changed.
//
// Deliberately out of scope: the Cursor harness (its model calls never
// traverse the mock, so the surface it pays for is not observable here);
// the number of model rounds a task takes (the mock's script fixes it, so
// only a live run can measure it); the model id the provider received
// (agentexecution-messages' model-resolution arm); the `messages` array (the
// transcript facet's, read from status).
//
// A golden moves only under a ruling quoted in the PR that moves it, with
// every hunk explained; never a quiet `vitest -u`.
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { readAnthropicRequest, type AnthropicRequestBody } from "../harness/llm-wire";
import type { MockLlmProxy } from "../harness/mock-llm";
import { anthropicText } from "../harness/mock-llm";
import { makeAgent } from "../support/agents";
import { awaitTerminal, makeAgentExecution, requireLlmProxy } from "../support/agentexecutions";
import { uniqueName } from "../support/naming";
import { renderSystemPrompt, renderToolSurface } from "../support/request-shape";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
});

afterEach(async () => {
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

// The bare agent's one instruction: the only agent-authored bytes in the
// photograph. Fixed here so the golden's first block is this sentence and
// nothing else of the suite's choosing.
const BARE_AGENT_INSTRUCTIONS = "Answer in one short sentence.";
const BARE_AGENT_MESSAGE = "Say hello.";

// One turn of a bare agent, scripted as a single text reply, on a fresh
// session (no sessionId) or an existing one. Returns the terminal execution
// and the request the agent loop sent — the scripted one, never the
// background titling call the mock answers out of band.
async function runBareAgentTurn(
  org: string,
  agentId: string,
  sessionId?: string,
): Promise<{ final: AgentExecution; request: AnthropicRequestBody }> {
  const scriptedBefore = mock.scriptedRequests().length;
  mock.enqueue(anthropicText("Hello."));
  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({
      org,
      name: uniqueName("aex-shape"),
      ...(sessionId === undefined ? { agentId } : { sessionId }),
      message: BARE_AGENT_MESSAGE,
      autoApproveAll: true,
    }),
  );
  const executionId = execution.metadata!.id;
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

  const final = await awaitTerminal(clients, executionId);
  expect(
    final.status?.phase,
    `the bare turn should complete; ${executionId} reached ${ExecutionPhase[final.status?.phase ?? 0]} ` +
      `(status.error: ${JSON.stringify(final.status?.error ?? "")})`,
  ).toBe(ExecutionPhase.EXECUTION_COMPLETED);

  const scripted = mock.scriptedRequests();
  expect(scripted.length, "one scripted text turn is exactly one request from the agent loop").toBe(scriptedBefore + 1);
  return { final, request: readAnthropicRequest(scripted[scriptedBefore]!.body) };
}

async function createBareAgent(): Promise<{ org: string; agentId: string }> {
  const { org } = await target.provisionTenancy();
  const agent = await clients.agentCommand.create(
    makeAgent({ org, name: uniqueName("agent-shape"), instructions: BARE_AGENT_INSTRUCTIONS }),
  );
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return { org, agentId: agent.metadata!.id };
}

describe("AgentExecution request shape — what the native harness sends the model for a bare agent", () => {
  it("the system prompt blocks, as the provider receives them, match the golden", async () => {
    const { org, agentId } = await createBareAgent();
    const { request } = await runBareAgentTurn(org, agentId);

    expect(Array.isArray(request.system), "the engine sends the system prompt as an array of blocks, not one string").toBe(
      true,
    );
    await expect(renderSystemPrompt(request)).toMatchFileSnapshot(
      "./goldens/agentexecution-request-shape.native-bare-agent.system-prompt.md",
    );
  });

  it("the tool surface — names, descriptions and schemas in wire order — matches the golden", async () => {
    const { org, agentId } = await createBareAgent();
    const { request } = await runBareAgentTurn(org, agentId);

    expect(request.tools?.length ?? 0, "a bare native agent still binds the engine's built-in tools").toBeGreaterThan(0);
    await expect(renderToolSurface(request)).toMatchFileSnapshot(
      "./goldens/agentexecution-request-shape.native-bare-agent.tool-surface.md",
    );
  });

  it("extended thinking is not requested and the temperature is pinned to 0", async () => {
    const { org, agentId } = await createBareAgent();
    const { request } = await runBareAgentTurn(org, agentId);

    expect(request.thinking, "no thinking block leaves the runner for a native model today").toBeUndefined();
    expect(request.temperature, "the runner pins the sampling temperature").toBe(0);
  });

  it("a second turn in the same session sends byte-identical system blocks and tools", async () => {
    const { org, agentId } = await createBareAgent();
    const first = await runBareAgentTurn(org, agentId);
    const sessionId = first.final.spec?.sessionId;
    expect(sessionId, "the first turn's session is where the second turn runs").toBeTruthy();

    const second = await runBareAgentTurn(org, agentId, sessionId);

    expect(JSON.stringify(second.request.system), "the system prompt is rebuilt to the same bytes").toBe(
      JSON.stringify(first.request.system),
    );
    expect(JSON.stringify(second.request.tools), "the tool surface is rebuilt to the same bytes").toBe(
      JSON.stringify(first.request.tools),
    );
  });
});
