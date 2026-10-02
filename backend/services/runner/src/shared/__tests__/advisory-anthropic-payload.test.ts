/**
 * The request each advising middleware produces, sent through the REAL
 * @langchain/anthropic conversion (stigmer/stigmer#1354).
 *
 * The middleware suites check the message a middleware adds; only the
 * provider's own conversion can say whether a request carrying it is one
 * Anthropic accepts. That conversion is what failed every native run that
 * reached an advisory: a mid-conversation system message, which
 * `_convertMessagesToAnthropicPayload` refuses. The converter is not on the
 * package's public exports, so these tests reach it the way production does:
 * a `ChatAnthropic` whose client is a fake that records the payload
 * `messages.create` is handed. No request leaves the process.
 *
 * Each arm drives one middleware until it fires, takes the request it hands
 * its handler on the next call, prepends the system prompt as the agent node
 * does (`[systemMessage, ...request.messages]`), and asserts the payload:
 * no system role among the messages, every `tool_use` answered by the user
 * turn right after it, and the advisory as a user turn after that, which the
 * API combines with the tool results into one turn. A last case pins that the
 * old shape is exactly what the client refuses.
 */

import { describe, expect, it } from "vitest";
import { ChatAnthropic } from "@langchain/anthropic";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";

import { createExecutionBudgetMiddleware } from "../../middleware/execution-budget.js";
import { createCostAdvisoryMiddleware } from "../../middleware/cost-advisory.js";
import { createLoopDetectionMiddleware } from "../../middleware/loop-detection.js";
import { ADVISORY_LEAD_IN } from "../../middleware/advisory-message.js";
import type { ModelCallRequest, StigmerMiddleware } from "../../middleware/types.js";

interface AnthropicPayload {
  readonly system?: unknown;
  readonly messages: ReadonlyArray<{ role: string; content: unknown }>;
}

/** A ChatAnthropic whose client records every payload and answers with a one-line message. */
function capturingModel(): { model: ChatAnthropic; payloads: AnthropicPayload[] } {
  const payloads: AnthropicPayload[] = [];
  const model = new ChatAnthropic({
    model: "claude-haiku-4-5-20251001",
    apiKey: "offline",
    maxRetries: 0,
    createClient: () =>
      ({
        messages: {
          create: async (payload: AnthropicPayload) => {
            payloads.push(payload);
            return {
              id: "msg_offline",
              type: "message",
              role: "assistant",
              model: "claude-haiku-4-5-20251001",
              content: [{ type: "text", text: "ok" }],
              stop_reason: "end_turn",
              stop_sequence: null,
              usage: { input_tokens: 1, output_tokens: 1 },
            };
          },
        },
      }) as never,
  });
  return { model, payloads };
}

/** The history every model call in these arms sees: a user turn, one tool call and its result. */
const HISTORY: BaseMessage[] = [
  new HumanMessage("Read the file."),
  new AIMessage({ content: "", tool_calls: [{ id: "toolu_1", name: "read_file", args: { file_path: "/a.md" }, type: "tool_call" }] }),
  new ToolMessage({ content: "contents", tool_call_id: "toolu_1" }),
];

const REQUEST: ModelCallRequest = { model: {}, messages: HISTORY, state: { messages: HISTORY }, runtime: {} };

function toolResponse(args: Record<string, unknown>, usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15 }): AIMessage {
  return new AIMessage({
    content: "",
    tool_calls: [{ id: "toolu_next", name: "read_file", args, type: "tool_call" }],
    usage_metadata: usage,
  });
}

/**
 * Calls `mw` with `respond` until a call's request carries more than the
 * history, and returns that request: the one the middleware advised.
 */
async function firstAdvisedRequest(mw: StigmerMiddleware, respond: (call: number) => AIMessage, maxCalls = 40): Promise<ModelCallRequest> {
  for (let call = 0; call < maxCalls; call++) {
    let seen: ModelCallRequest | undefined;
    await mw.wrapModelCall!(REQUEST, async (request) => {
      seen = request;
      return respond(call);
    });
    if (seen && seen.messages.length > HISTORY.length) return seen;
  }
  throw new Error(`${mw.name} advised no request within ${maxCalls} calls`);
}

async function payloadFor(request: ModelCallRequest): Promise<AnthropicPayload> {
  const { model, payloads } = capturingModel();
  await model.invoke([new SystemMessage("You are a test agent."), ...(request.messages as BaseMessage[])]);
  expect(payloads).toHaveLength(1);
  return payloads[0];
}

function assertAdvisedPayload(payload: AnthropicPayload): void {
  expect(payload.system, "the system prompt rides the request's own field").toBeDefined();
  expect(payload.messages.map((m) => m.role), "no system role among the messages").toEqual(["user", "assistant", "user", "user"]);

  const toolUse = payload.messages[1].content as Array<{ type: string; id?: string }>;
  expect(toolUse.map((b) => b.type)).toEqual(["tool_use"]);
  const results = payload.messages[2].content as Array<{ type: string; tool_use_id?: string }>;
  expect(results.map((b) => b.type), "the tool_use is answered by the turn right after it").toEqual(["tool_result"]);
  expect(results[0].tool_use_id).toBe(toolUse[0].id);

  const advisory = payload.messages[3].content;
  const text = typeof advisory === "string" ? advisory : (advisory as Array<{ text?: string }>).map((b) => b.text ?? "").join("");
  expect(text.startsWith(ADVISORY_LEAD_IN), "the advisory follows the results as a user turn").toBe(true);
}

describe("an advised request through the real @langchain/anthropic conversion", () => {
  it("the tool-round budget's advisory at 80% of max_tool_rounds", async () => {
    const mw = createExecutionBudgetMiddleware({ maxToolRounds: 10, warningPct: 80 });
    const request = await firstAdvisedRequest(mw, (call) => toolResponse({ file_path: `/f${call}.md` }));
    assertAdvisedPayload(await payloadFor(request));
  });

  it("the sub-agent stack's periodic advisory", async () => {
    const mw = createExecutionBudgetMiddleware({ warningInterval: 30, maxWarnings: 4 });
    const request = await firstAdvisedRequest(mw, (call) => toolResponse({ file_path: `/f${call}.md` }));
    assertAdvisedPayload(await payloadFor(request));
  });

  it("the cost advisory once the estimate crosses 80% of max_cost_usd", async () => {
    const mw = createCostAdvisoryMiddleware({
      maxCostUsd: 1,
      inputPricePerMillion: 100_000,
      outputPricePerMillion: 100_000,
      cacheReadPricePerMillion: 0,
      warningPct: 80,
    });
    const request = await firstAdvisedRequest(mw, (call) => toolResponse({ file_path: `/f${call}.md` }));
    assertAdvisedPayload(await payloadFor(request));
  });

  it("loop detection's warning after seven identical calls", async () => {
    const mw = createLoopDetectionMiddleware();
    const request = await firstAdvisedRequest(mw, () => toolResponse({ file_path: "/same.md" }));
    assertAdvisedPayload(await payloadFor(request));
  });

  it("refuses the shape these advisories had: a system message after the first", async () => {
    const { model } = capturingModel();
    await expect(model.invoke([new SystemMessage("sys"), ...HISTORY, new SystemMessage("warning")])).rejects.toThrow(
      /System messages are only permitted as the first passed message/,
    );
  });
});
