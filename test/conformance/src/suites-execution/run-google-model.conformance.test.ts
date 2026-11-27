// Conformance suite for a turn on a Google model (Class B).
// Domain: agentic / agentexecution — the runner's wire to a model named
// `google:<name>`.
//
// The contract under test: an agent whose model is `google:<name>` is saved
// and run like any other, and the runner speaks Google's own protocol
// (Gemini's `streamGenerateContent`) to the platform's Google path,
// `/v1/proxy/llm/google/v1beta/models/<name>:streamGenerateContent`, with
// the run's credential as a bearer: the wire a platform proxy's Google lane
// serves. Through it a turn calls a tool, calls a gated one, waits for the
// person's allow, resumes, and completes. Google signs every function call
// and refuses a conversation that sends one back without its signature; the
// mock does the same (disposition `refused`), so a completed turn is the
// proof the signatures survived the stream, the checkpoint and the resume.
//
// Out of scope: Google as a key slot (a run judged for a Google key is
// run-admission's, the readiness answer platform's), the platform proxy's
// lane itself, and real Gemini models (the runner's live suites).
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { McpToolFixture } from "../harness/mcp-server";
import { DESTRUCTIVE_ECHO_TOOL_NAME, mcpToolName } from "../harness/mcp-server";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
import { mockThoughtSignature, readGeminiRequest } from "@stigmer/test-support/llm-wire";
import { agentRefOf, makeAgent } from "../support/agents";
import { awaitPhase, awaitTerminal, makeAgentExecution, pushFixturePlugin, requireLlmProxy, requireMcpFixture, sessionIdOf } from "../support/runs";
import { toolServerSegment } from "../support/plugins";
import { awaitRequiresAction, confirmPerContract } from "../support/answers";
import { toolUsesOf, turnById, turnOfRun } from "../support/turn";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

const GOOGLE_MODEL = "gemini-3-flash";
const GOOGLE_STREAM_PATH = `/v1/proxy/llm/google/v1beta/models/${GOOGLE_MODEL}:streamGenerateContent?alt=sse`;

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

describe("Run — a turn on a google: model", () => {
  it("calls a tool, waits at a gated one, resumes on the person's allow and completes, on Google's wire", async () => {
    const { org } = await target.provisionTenancy();
    const plugin = await pushFixturePlugin(clients, mcp, fixtures, { org, name: uniqueName("gated"), tools: [DESTRUCTIVE_ECHO_TOOL_NAME] });
    const agent = await clients.agentCommand.create(
      makeAgent({
        org,
        name: uniqueName("agent-gemini"),
        plugins: [plugin.metadata!.slug],
        harness: Harness.STIGMER,
        runConfig: { modelName: `google:${GOOGLE_MODEL}` },
      }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
    const echo = mcpToolName(toolServerSegment(plugin.metadata!.name), DESTRUCTIVE_ECHO_TOOL_NAME);
    mock
      .enqueue(anthropicToolUse("call_todos", "write_todos", { todos: [{ content: "echo the word", status: "in_progress" }] }))
      .enqueue(anthropicToolUse("call_echo", echo, { text: "gemini" }))
      .enqueue(anthropicText("Done."));

    const created = await clients.agentExecutionCommand.create(makeAgentExecution({ org, name: uniqueName("run-gemini"), agentRef: agentRefOf(agent) }));
    const runId = created.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: runId }));
    const gated = await awaitPhase(clients, runId, RunPhase.RUN_WAITING_FOR_APPROVAL, { label: "WAITING_FOR_APPROVAL" });
    const sessionId = sessionIdOf(gated);
    await awaitRequiresAction(clients, sessionId, 1);
    const [ask] = (await turnById(clients, sessionId, runId)).asks;
    await confirmPerContract({
      clients,
      sessionId,
      runId,
      expectedRemaining: 0,
      label: "the allow clears the gate",
      answer: () => clients.sessionCommand.confirmToolUse({ sessionId, toolUseId: ask!.id, result: "allow" }),
    });

    const final = await awaitTerminal(clients, runId);
    expect(final.status?.phase, `${final.status?.error ?? ""}\n${mock.describeTraffic()}`).toBe(RunPhase.RUN_COMPLETED);
    expect(final.status?.runConfig?.modelName).toBe(`google:${GOOGLE_MODEL}`);
    const uses = toolUsesOf(await turnOfRun(clients, final));
    expect(uses.map((use) => [use.name, use.state])).toEqual([
      ["write_todos", "completed"],
      [DESTRUCTIVE_ECHO_TOOL_NAME, "completed"],
    ]);

    const loop = mock.scriptedRequests();
    expect(mock.requests().map((request) => request.disposition), "no request broke Google's signature rule").not.toContain("refused");
    expect(loop.map((request) => request.path)).toEqual([GOOGLE_STREAM_PATH, GOOGLE_STREAM_PATH, GOOGLE_STREAM_PATH]);
    expect(loop.every((request) => typeof request.headers.authorization === "string" && request.headers.authorization.startsWith("Bearer "))).toBe(true);
    expect(loop.every((request) => request.headers["x-goog-api-key"] === undefined), "no Google key reaches the platform").toBe(true);
    const sentBack = readGeminiRequest(loop[2]!.body)
      .contents.filter((content) => content.role === "model")
      .flatMap((content) => content.parts)
      .filter((part) => part.functionCall !== undefined)
      .map((part) => part.thoughtSignature);
    expect(sentBack, "both calls went back signed after the resume").toEqual([mockThoughtSignature("call_todos"), mockThoughtSignature("call_echo")]);
  });
});
