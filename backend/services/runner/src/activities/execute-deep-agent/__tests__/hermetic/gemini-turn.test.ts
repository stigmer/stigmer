/**
 * Hermetic: a Stigmer turn on a Gemini model, through the REAL
 * `ExecuteDeepAgent` activity, the REAL model client and LangChain's Google
 * client, against the conformance mock's Gemini wire (`test/support`): two
 * tool calls, the second gated, the turn paused for its approval and resumed
 * on the durable (sqlite) checkpointer.
 *
 * What the scripted-model arms cannot show, and this does: the Google
 * client's own wire through the whole engine. Google signs each function
 * call and refuses a conversation that sends one back unsigned; the mock
 * does the same (disposition `refused`), so the turn completes only if every
 * signature survived the stream, the checkpoint and the resume.
 *
 * The engine runs where production runs it, in the agent host, and its model
 * calls cross the runner's REAL local proxy (`agent-proxy/server.ts`) in
 * forward mode, as on a runner behind the platform: the host's token is
 * checked on the Google lane and replaced by the runner's credential, and the
 * call reaches the mock on the platform's Google path, the wire the cloud's
 * lane serves.
 *
 * No golden: the scripted-model arms own the status shape; this one asserts
 * the provider-facing facts.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import { anthropicText, anthropicToolUse, MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { mockThoughtSignature, readGeminiRequest } from "@stigmer/test-support/llm-wire";

import { createHermeticEnvironment, type HermeticEnvironment } from "../../../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { beginLiveDeepAgentScenario, deepAgentExecutionRecord, runDeepAgentTurn, type ActivityFactory } from "../../__test-utils__/hermetic-deep-agent.js";
import { AgentProxy } from "../../../../agent-proxy/server.js";
import { ApprovalAction, ToolCallStatus } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

const MODEL = "google:gemini-3-flash";
/** The runner's credential, which the local proxy forwards model calls with. */
const RUN_TOKEN = "hermetic-runner-token";

/** The adapter in an agent host behind the real local proxy (`runtimeActivityFactory`, with the proxy in place of its stand-in). */
function behindProxy(proxy: AgentProxy): ActivityFactory {
  return async (config) => {
    const { createDeepAgentAdapter } = await import("../../adapter.js");
    const { createHarnessActivities } = await import("../../../../harness/registry.js");
    const { loopbackHostedRow } = await import("../../../../__test-utils__/loopback-host.js");
    const row = loopbackHostedRow({ harness: "stigmer", adapter: createDeepAgentAdapter() }, { proxy });
    await row.adapter.boot(config);
    const activities = await createHarnessActivities([row], config);
    return activities.ExecuteDeepAgent!;
  };
}
const DECIDED_AT = "2026-01-01T00:00:30.000Z";

describe("ExecuteDeepAgent hermetic — a Gemini turn with two tool calls and an approval (sqlite)", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  const mock = new MockLlmProxy();
  let proxy: AgentProxy;

  beforeAll(async () => {
    await mock.start();
    env = createHermeticEnvironment();
    // The fixture registry lists no Gemini model, so the name passes through;
    // the model calls go out to the mock.
    registry = stubRegistryFetch({ live: true });
  });

  afterAll(async () => {
    await proxy?.close();
    registry.restore();
    env.dispose();
    await mock.close();
  });

  it("runs a tool, pauses at the gated one, resumes signed, and completes with its usage counted", async () => {
    mock
      .enqueue(anthropicToolUse("call_todos", "write_todos", { todos: [{ content: "run the command", status: "in_progress" }] }, { inputTokens: 900, outputTokens: 20 }))
      .enqueue(anthropicToolUse("call_execute", "execute", { command: "echo hermetic-gemini" }, { inputTokens: 1_000, outputTokens: 25 }))
      .enqueue(anthropicText("The command printed hermetic-gemini.", { inputTokens: 1_100, outputTokens: 12 }));
    const record = deepAgentExecutionRecord({ message: "Plan it, then run `echo hermetic-gemini`.", modelName: MODEL });
    // A runner behind the platform, the mock standing for the platform's proxy.
    const scenario = beginLiveDeepAgentScenario({
      env,
      record,
      config: { checkpointerType: "sqlite", proxyEndpoint: mock.url(), stigmerTokenRef: { current: RUN_TOKEN } },
    });
    proxy = await AgentProxy.start(scenario.config);
    const activityFactory = behindProxy(proxy);

    // ── Turn 1: write_todos runs, execute waits for approval ─────────────────
    const turn1 = await runDeepAgentTurn(scenario, { turnSeq: 0, activityFactory });
    expect(turn1.outcome.kind, mock.describeTraffic()).toBe("returned");
    expect(record.persistedPhases.at(-1), record.lastFullStatus?.error ?? "").toBe(RunPhase.RUN_WAITING_FOR_APPROVAL);
    expect(record.waitingToolCalls().map((tc) => tc.name)).toEqual(["execute"]);
    expect(record.decideWaitingToolCalls(ApprovalAction.APPROVE, DECIDED_AT)).toBe(1);

    // ── Turn 2: execute runs, the model closes ───────────────────────────────
    const turn2 = await runDeepAgentTurn(scenario, { turnSeq: 1, activityFactory });
    expect(turn2.outcome.kind, mock.describeTraffic()).toBe("returned");
    const final = record.lastFullStatus!;
    expect(record.persistedPhases.at(-1), final.error ?? "").toBe(RunPhase.RUN_COMPLETED);
    const rows = record.rowsOf(final).messages.flatMap((m) => m.toolCalls);
    expect(rows.find((tc) => tc.name === "execute")).toMatchObject({ status: ToolCallStatus.TOOL_CALL_COMPLETED, approvalAction: ApprovalAction.APPROVE });
    expect(rows.find((tc) => tc.name === "execute")?.result).toContain("hermetic-gemini");

    // ── The provider's side ──────────────────────────────────────────────────
    const loop = mock.scriptedRequests();
    expect(mock.requests().map((r) => r.disposition), "no request broke Google's signature rule").not.toContain("refused");
    expect(loop).toHaveLength(3);
    expect(loop.every((r) => r.path === "/v1/proxy/llm/google/v1beta/models/gemini-3-flash:streamGenerateContent?alt=sse")).toBe(true);
    expect(loop.every((r) => r.headers.authorization === `Bearer ${RUN_TOKEN}` && r.headers["x-goog-api-key"] === undefined)).toBe(true);
    const lastCalls = readGeminiRequest(loop[2]!.body)
      .contents.filter((content) => content.role === "model")
      .flatMap((content) => content.parts)
      .filter((part) => part.functionCall !== undefined)
      .map((part) => part.thoughtSignature);
    expect(lastCalls, "both calls went back signed after the resume").toEqual([mockThoughtSignature("call_todos"), mockThoughtSignature("call_execute")]);
    expect(final.streamingUsage?.inputTokens).toBeGreaterThan(0n);
    expect(final.streamingUsage?.outputTokens).toBeGreaterThan(0n);
  });
});
