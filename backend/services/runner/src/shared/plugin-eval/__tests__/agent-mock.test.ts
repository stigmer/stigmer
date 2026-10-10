/**
 * Pins the agent mock's request and reading (`agent-mock.ts`): the
 * instructions as the system prompt, the server's earlier calls as the
 * conversation and this call last; an `ABORT:` first line ends the run only
 * when the mock may abort. The model itself (`chatAgentMockModel`) is the
 * eval's judge model or the runner's default, built with the try's proxy
 * scope, and its answer is priced from its usage on that model's pricing.
 */

import { AIMessage } from "@langchain/core/messages";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../../../config.js";

const built = vi.hoisted(() => ({ calls: [] as unknown[], reply: undefined as unknown }));

vi.mock("../../model-client.js", () => ({
  buildChatModel: (args: unknown) => {
    built.calls.push(args);
    return Promise.resolve({ model: { invoke: () => Promise.resolve(built.reply) } });
  },
}));
vi.mock("../../model-registry.js", () => ({ getDefaultModel: () => Promise.resolve("default-model") }));
vi.mock("../../model-pricing.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../model-pricing.js")>()),
  ensureLoaded: () => Promise.resolve(),
  getModelPricing: (model: string) => ({
    model,
    inputPricePerMillion: 1,
    outputPricePerMillion: 10,
    cacheWritePricePerMillion: 2,
    cacheReadPricePerMillion: 0.5,
  }),
}));

const { agentMockMessages, chatAgentMockModel, readAnswer } = await import("../agent-mock.js");

describe("agentMockMessages", () => {
  it("frames the instructions, replays the server's history, and asks this call last", () => {
    const messages = agentMockMessages({
      server: "tracker",
      tool: "get_issue",
      instructions: "You are an issue tracker.",
      abortWhen: "the issue id is negative",
      input: { id: 12 },
      history: [{ tool: "create_issue", input: { title: "Crash" }, answer: "Created #12" }],
    });
    expect(messages.map((m) => [m.getType(), m.content])).toEqual([
      [
        "system",
        [
          "You are standing in for the MCP server 'tracker' while a plugin is tested.",
          "Answer each tool call exactly as that server would, following these instructions, and reply with the tool's result only.",
          "",
          "You are an issue tracker.",
          "",
          "You may end the test only when one of these conditions holds: the issue id is negative",
          "To end it, reply with a single first line `ABORT: <the reason>` and nothing else.",
        ].join("\n"),
      ],
      ["human", 'Tool: create_issue\nInput: {"title":"Crash"}'],
      ["ai", "Created #12"],
      ["human", 'Tool: get_issue\nInput: {"id":12}'],
    ]);
  });

  it("says nothing of ending the test when the mock may not", () => {
    const [system] = agentMockMessages({ server: "s", tool: "t", instructions: "Answer.", abortWhen: "", input: undefined, history: [] });
    expect(String(system?.content)).not.toContain("ABORT");
  });
});

describe("readAnswer", () => {
  it("reads an ABORT first line as the end of the run, only when the mock may abort", () => {
    expect(readAnswer("ABORT: the issue id is negative", true, 0.1)).toEqual({ kind: "abort", reason: "the issue id is negative", costUsd: 0.1 });
    expect(readAnswer("ABORT:", true, 0)).toEqual({ kind: "abort", reason: "the mock ended the run", costUsd: 0 });
    expect(readAnswer("ABORT: no", false, 0)).toEqual({ kind: "answer", text: "ABORT: no", costUsd: 0 });
    expect(readAnswer("Issue #12\nABORT: later line", true, 0)).toEqual({ kind: "answer", text: "Issue #12\nABORT: later line", costUsd: 0 });
  });
});

describe("chatAgentMockModel", () => {
  const config = { proxyEndpoint: "https://proxy.test", stigmerTokenRef: { current: "tok" } } as unknown as Config;
  const request = { server: "s", tool: "t", instructions: "Answer.", abortWhen: "never", input: { a: 1 }, history: [] };

  beforeEach(() => {
    built.calls = [];
  });

  it("asks the named model through the try's proxy scope and prices its usage", async () => {
    const reply = new AIMessage({ content: "ABORT: never mind" });
    reply.usage_metadata = {
      input_tokens: 1_000_000,
      output_tokens: 100_000,
      total_tokens: 1_100_000,
      input_token_details: { cache_read: 200_000, cache_creation: 300_000 },
    };
    built.reply = reply;
    const answer = await chatAgentMockModel({ modelName: "judge", config, executionId: "aex_1" })(request);
    expect(built.calls).toEqual([
      {
        modelName: "judge",
        proxyEndpoint: "https://proxy.test",
        stigmerToken: "tok",
        headerScope: { executionId: "aex_1" },
        temperature: null,
        maxTokens: 4096,
      },
    ]);
    // 0.5M fresh input at 1, 0.1M output at 10, 0.3M written at 2, 0.2M read at 0.5.
    expect(answer).toEqual({ kind: "abort", reason: "never mind", costUsd: 0.5 + 1 + 0.6 + 0.1 });
  });

  it("falls back to the runner's default model, reads text parts, and prices an answer without usage at 0", async () => {
    built.reply = new AIMessage({ content: [{ type: "text", text: "Created " }, { type: "image_url", image_url: "x" }, { type: "text", text: "#4" }] });
    const bare = { proxyEndpoint: null, stigmerTokenRef: { current: null } } as unknown as Config;
    const answer = await chatAgentMockModel({ modelName: "", config: bare, executionId: "aex_2" })({ ...request, abortWhen: "" });
    expect(built.calls).toEqual([expect.objectContaining({ modelName: "default-model", proxyEndpoint: undefined, stigmerToken: undefined })]);
    expect(answer).toEqual({ kind: "answer", text: "Created #4", costUsd: 0 });
  });

  it("reads content that is neither text nor parts as an empty answer", async () => {
    built.reply = { content: 7 };
    const answer = await chatAgentMockModel({ modelName: "judge", config, executionId: "aex_3" })({ ...request, abortWhen: "" });
    expect(answer).toEqual({ kind: "answer", text: "", costUsd: 0 });
  });
});
