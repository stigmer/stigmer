/**
 * Hermetic scenario: a model reply that fails after it began is tried
 * again, through the whole `ExecuteDeepAgent` activity on the real graph
 * with the scripted model.
 *
 * The scripted model replaces `buildChatModel` whole, so the request loop's
 * retry (LangChain's client retry, configured there) is not in play here;
 * it is `shared/__tests__/model-retry-seam.test.ts`'s, on the real SDKs.
 * What this pins is the stream loop (`middleware/model-retry.ts`) in the
 * graph the runner really builds, the parent's and a sub-agent's.
 *
 * Three arms:
 *  - The parent's first call streams some thinking and text and fails with
 *    the provider's mid-reply overload (the SDK's own status-less
 *    `APIError`); the retry answers with a tool call, then the reply. The
 *    turn completes, the model's second request holds no trace of the
 *    partial reply, the person's transcript shows the partial message and
 *    then the replies, no persist after the retry shows the failed call's
 *    thinking still streaming (a call that threw never finishes; the next
 *    run's start closes it), and the runner's log holds one
 *    `phase=stream decision=retry` line.
 *  - A call failing with a 401 fails the turn once, as before, with the
 *    authentication wording.
 *  - The same overload inside a sub-agent is retried there, and the
 *    sub-agent's report reaches the parent.
 *
 * Structure and side effects only; no golden.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { APIError } from "@anthropic-ai/sdk";
import { AIMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";

vi.mock("../../../../shared/model-client.js", async () =>
  (await import("../../__test-utils__/scripted-model-module.js")).scriptedModelClientModule(),
);
vi.mock("../../../../client/stigmer-client.js", async () =>
  (await import("../../../../__test-utils__/hermetic-activity.js")).hermeticStigmerClientModule(),
);

import {
  ScriptedClock,
  createHermeticEnvironment,
  type HermeticEnvironment,
} from "../../../../__test-utils__/hermetic-activity.js";
import { stubRegistryFetch } from "../../../../__test-utils__/model-registry-fixture.js";
import { beginDeepAgentScenario, deepAgentExecutionRecord, runDeepAgentTurn } from "../../__test-utils__/hermetic-deep-agent.js";
import type { ScriptedTurn } from "../../__test-utils__/scripted-model.js";
import { MessageType } from "../../../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

const THOUGHT = "The suite lives under test/.";
const PARTIAL = "Let me look at the fail";
const CHECKING = "Checking the suite.";
const TODOS = "call-hermetic-retry-todos-0001";
const REPLY = "The suite passes.";

/** The provider's overload after its reply began: the SDK's `event: error` shape, no status. */
function midReplyOverload(): Error {
  return new APIError(undefined, { type: "error", error: { type: "overloaded_error", message: "Overloaded" } }, undefined, new Headers(), "overloaded_error");
}

/** A turn player that fails its first call after `partial` with `error`, then plays `answers` in turn; records each request. */
function failOnceThen(partial: Omit<ScriptedTurn, "ends">, error: () => Error, ...answers: ScriptedTurn[]) {
  const requests: (readonly BaseMessage[])[] = [];
  let failed = false;
  const play = (transcript: readonly BaseMessage[]): ScriptedTurn => {
    requests.push([...transcript]);
    if (failed) return answers.length > 1 ? answers.shift()! : answers[0]!;
    failed = true;
    return { ...partial, ends: { kind: "fail", error: error() } };
  };
  return { play, requests };
}

function textOf(message: BaseMessage): string {
  return typeof message.content === "string" ? message.content : JSON.stringify(message.content);
}

describe("ExecuteDeepAgent hermetic — a model reply that fails after it began", () => {
  let env: HermeticEnvironment;
  let registry: ReturnType<typeof stubRegistryFetch>;
  let warn: ReturnType<typeof vi.spyOn>;
  const clock = new ScriptedClock();

  beforeAll(() => {
    env = createHermeticEnvironment();
    registry = stubRegistryFetch();
    clock.install();
  });

  afterAll(() => {
    clock.uninstall();
    registry.restore();
    env.dispose();
  });

  beforeEach(() => {
    warn = vi.spyOn(console, "warn");
  });

  afterEach(() => {
    warn.mockRestore();
  });

  const retryLines = () =>
    warn.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith("[MODEL-RETRY]"));

  it("calls the model again; the partial stays on screen and never reaches the model", { timeout: 30_000 }, async () => {
    clock.reset();
    const record = deepAgentExecutionRecord({ message: "Does the suite pass?" });
    const parent = failOnceThen(
      { reasoning: THOUGHT, text: PARTIAL },
      midReplyOverload,
      { text: CHECKING, toolCalls: [{ id: TODOS, name: "write_todos", args: { todos: [{ content: "Run the suite", status: "in_progress" }] } }] },
      { text: REPLY },
    );
    const scenario = beginDeepAgentScenario({ env, clock, record, script: () => parent.play });

    const invocation = await runDeepAgentTurn(scenario);

    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
    expect(parent.requests).toHaveLength(3);
    expect(parent.requests[1].some((m) => AIMessage.isInstance(m) && textOf(m).includes(PARTIAL)), "the model never sees the partial").toBe(false);

    const ai = record.rowsOf(record.lastFullStatus!).messages.filter((m) => m.type === MessageType.MESSAGE_AI);
    expect(ai.map((m) => m.content)).toEqual([PARTIAL, CHECKING, REPLY]);

    // The failed call never finished; the retry's start closed its thinking,
    // so no persist after the retry shows a spinner on it.
    const midTurn = record.persistedRows.filter((rows) => rows.messages.some((m) => m.content === CHECKING));
    expect(midTurn.length, "a persist while the retried reply's tool ran").toBeGreaterThan(0);
    for (const rows of midTurn) {
      const thought = rows.messages.find((m) => m.type === MessageType.MESSAGE_THINKING && m.content === THOUGHT);
      expect(thought?.isStreaming, "the failed call's thinking is closed").toBe(false);
    }

    expect(retryLines()).toHaveLength(1);
    expect(retryLines()[0]).toMatch(/^\[MODEL-RETRY\] phase=stream decision=retry reason=overloaded attempt=1\/3 delay_ms=\d+$/);
  });

  it("fails the turn once on a failure that cannot pass", { timeout: 30_000 }, async () => {
    clock.reset();
    const record = deepAgentExecutionRecord({ message: "Does the suite pass?" });
    const unauthorized = () =>
      APIError.generate(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, undefined, new Headers());
    const parent = failOnceThen({}, unauthorized, { text: REPLY });
    const scenario = beginDeepAgentScenario({ env, clock, record, script: () => parent.play });

    const invocation = await runDeepAgentTurn(scenario);

    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_FAILED");
    expect(parent.requests).toHaveLength(1);
    expect(record.lastFullStatus!.error).toMatch(/^\[LLM_AUTHENTICATION_ERROR\] Authentication failed/);
    expect(retryLines()).toEqual(["[MODEL-RETRY] phase=stream decision=stop reason=refused attempt=1/3 delay_ms=none"]);
  });

  it("retries a sub-agent's failed reply inside the sub-agent", { timeout: 30_000 }, async () => {
    clock.reset();
    const HELPER_INSTRUCTIONS = "You are the hermetic test runner. Report the result.";
    const helper = create(AgentSchema, {
      metadata: { id: "agt_runner", name: "runner", slug: "runner" },
      spec: { description: "Runs the suite and reports.", instructions: HELPER_INSTRUCTIONS },
      status: { versionHash: "f".repeat(64) },
    });
    const record = deepAgentExecutionRecord({ message: "Have the runner check the suite.", subagents: [helper], autoApproveAll: true });
    const TASK = "call-hermetic-retry-task-0001";
    const sub = failOnceThen({ text: PARTIAL }, midReplyOverload, { text: REPLY });
    let report: string | undefined;
    const scenario = beginDeepAgentScenario({
      env,
      clock,
      record,
      clientOverrides: { getAgentByReference: vi.fn(async () => helper) },
      script: (_tools, context) => (transcript): ScriptedTurn => {
        if (context.systemPrompt.includes(HELPER_INSTRUCTIONS)) return sub.play(transcript);
        const answered = transcript.find((m) => ToolMessage.isInstance(m) && m.tool_call_id === TASK);
        if (answered === undefined) {
          return { text: "Delegating.", toolCalls: [{ id: TASK, name: "task", args: { description: "Check the suite.", subagent_type: "runner" } }] };
        }
        report = textOf(answered);
        return { text: "The runner reported." };
      },
    });

    const invocation = await runDeepAgentTurn(scenario);

    expect((invocation.outcome as { value: Record<string, unknown> }).value.phase).toBe("RUN_COMPLETED");
    expect(sub.requests).toHaveLength(2);
    expect(report).toContain(REPLY);
    expect(retryLines()).toHaveLength(1);
  });
});
