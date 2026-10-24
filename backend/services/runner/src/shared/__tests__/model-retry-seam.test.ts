/**
 * The request loop's retry on the real seam: the real `buildChatModel`,
 * the real LangChain wrappers and provider SDKs, against a local HTTP
 * server standing where the Stigmer proxy stands (`proxyEndpoint`), for
 * both providers. What it pins is what a unit test of the rule cannot: that
 * the count and the hook `buildChatModel` sets reach LangChain's client
 * loop, that p-retry keeps the provider's wait, and that a reply failing
 * after it began is left to the stream loop, unstamped.
 *
 * Real waits, kept to first gaps (about one to two seconds a retry); each
 * case has its own timeout.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { HumanMessage } from "@langchain/core/messages";
import { getRetryable } from "@langchain/core/errors";

import { buildChatModel } from "../model-client.js";
import { _resetRegistryCache } from "../model-registry.js";
import { retryDecisionOf } from "../model-retry.js";

type Answer =
  | { readonly status: number; readonly headers?: Record<string, string>; readonly body: unknown }
  | { readonly stream: readonly string[] }
  | "hang";

const PROVIDERS = {
  anthropic: { id: "claude-haiku-4.5", apiModelId: "claude-haiku-4-5-20251001", path: "/v1/messages" },
  openai: { id: "gpt-4.1", apiModelId: "gpt-4.1", path: "/chat/completions" },
} as const;
type Provider = keyof typeof PROVIDERS;

function sse(events: readonly Record<string, unknown>[], named: boolean): string[] {
  return events.map((event) => `${named ? `event: ${String(event.type)}\n` : ""}data: ${JSON.stringify(event)}\n\n`);
}

function goodStream(provider: Provider): Answer {
  if (provider === "anthropic") {
    return {
      stream: sse([
        { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: PROVIDERS.anthropic.apiModelId, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } },
        { type: "message_stop" },
      ], true),
    };
  }
  const chunk = (delta: Record<string, unknown>, finish: string | null) =>
    ({ id: "c1", object: "chat.completion.chunk", created: 1, model: PROVIDERS.openai.apiModelId, choices: [{ index: 0, delta, finish_reason: finish }] });
  return { stream: [...sse([chunk({ role: "assistant", content: "hello" }, null), chunk({}, "stop")], false), "data: [DONE]\n\n"] };
}

/** A reply that begins with a 200 and fails partway: the shape no request loop sees. */
function failingStream(provider: Provider): Answer {
  if (provider === "anthropic") {
    return {
      stream: [
        ...sse([{ type: "message_start", message: { id: "msg_2", type: "message", role: "assistant", model: PROVIDERS.anthropic.apiModelId, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 1 } } }], true),
        `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } })}\n\n`,
      ],
    };
  }
  return { stream: [`data: ${JSON.stringify({ error: { message: "The server had an error", type: "server_error" } })}\n\n`] };
}

function errorBody(type: string, message = type) {
  return { type: "error", error: { type, message, code: type } };
}

describe.each(Object.keys(PROVIDERS) as Provider[])("the request loop's retry, %s through the proxy seam", (provider) => {
  let server: Server;
  let endpoint: string;
  let answers: Answer[] = [];
  let requests = 0;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      req.resume();
      if (!req.url?.endsWith(PROVIDERS[provider].path)) {
        res.writeHead(404).end();
        return;
      }
      requests++;
      const answer = answers.shift() ?? { status: 500, body: errorBody("api_error", "the test ran out of answers") };
      if (answer === "hang") return;
      if ("stream" in answer) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        for (const event of answer.stream) res.write(event);
        res.end();
        return;
      }
      res.writeHead(answer.status, { "content-type": "application/json", ...answer.headers });
      res.end(JSON.stringify(answer.body));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    _resetRegistryCache();
    answers = [];
    requests = 0;
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { id, apiModelId } = PROVIDERS[provider];
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ models: [{ id, apiModelId, provider }] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    server.closeAllConnections();
  });

  async function call(timeoutMs?: number) {
    const { model } = await buildChatModel({
      modelName: PROVIDERS[provider].id,
      proxyEndpoint: endpoint,
      stigmerToken: "seam-token",
      streaming: true,
      maxTokens: 64,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });
    return model.invoke([new HumanMessage("hi")]);
  }

  it("rides out an overload: 529, then a good reply", { timeout: 15_000 }, async () => {
    answers = [{ status: 529, body: errorBody("overloaded_error") }, goodStream(provider)];
    const reply = await call();
    expect(reply.text).toBe("hello");
    expect(requests).toBe(2);
    expect(warn).toHaveBeenCalledWith("[MODEL-RETRY] phase=request decision=retry reason=overloaded status=529 retry_after_ms=none");
  });

  it("retries a 429 that names no wait (the relay's 429 before it carried the hint)", { timeout: 15_000 }, async () => {
    answers = [{ status: 429, body: errorBody("rate_limit_error") }, goodStream(provider)];
    await expect(call()).resolves.toBeDefined();
    expect(requests).toBe(2);
  });

  it("waits out the provider's retry-after, past p-retry's own first gap", { timeout: 15_000 }, async () => {
    answers = [{ status: 429, headers: { "retry-after": "3" }, body: errorBody("rate_limit_error") }, goodStream(provider)];
    const started = performance.now();
    await call();
    expect(performance.now() - started).toBeGreaterThanOrEqual(3_000);
    expect(requests).toBe(2);
  });

  it.each([
    ["a quota 429", { status: 429, body: errorBody("insufficient_quota", "You exceeded your current quota, please check your plan and billing details.") }],
    ["a 401", { status: 401, body: errorBody("authentication_error") }],
    ["the cloud's refusal, 502 with x-should-retry false", { status: 502, headers: { "x-should-retry": "false" }, body: errorBody("api_error") }],
  ] as const)("makes one attempt for %s", { timeout: 15_000 }, async (_name, answer) => {
    answers = [answer, goodStream(provider)];
    const failure = await call().then(() => undefined, (err: unknown) => err);
    expect(failure).toBeInstanceOf(Error);
    expect(requests).toBe(1);
    expect(getRetryable(failure), "stamped as handled").toBe(false);
  });

  it("retries an attempt the bound timed out", { timeout: 15_000 }, async () => {
    answers = ["hang", goodStream(provider)];
    const reply = await call(300);
    expect(reply.text).toBe("hello");
    expect(requests).toBe(2);
  });

  it("leaves a reply that failed after it began to the stream loop, unstamped", { timeout: 15_000 }, async () => {
    answers = [failingStream(provider), goodStream(provider)];
    const failure = await call().then(() => undefined, (err: unknown) => err);
    expect(requests).toBe(1);
    expect(getRetryable(failure)).toBeUndefined();
    expect(retryDecisionOf(failure)).toMatchObject({ retry: true });
  });
});
