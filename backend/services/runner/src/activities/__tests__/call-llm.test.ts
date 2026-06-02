import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callLlmAction, createCallLlmActivities, type LlmCallConfig } from "../call-llm.js";
import { _resetRegistryCache } from "../../shared/model-registry.js";

const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

describe("callLlmAction", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch;
    _resetRegistryCache();
    delete process.env.STIGMER_PROXY_ENDPOINT;
    delete process.env.STIGMER_TOKEN;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.assign(process.env, originalEnv);
  });

  function emptyRegistryResponse() {
    return new Response(JSON.stringify({ models: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  // The LangChain provider SDKs pass a `Headers` instance (not a plain object)
  // to fetch, so read header values case-insensitively via the Headers API.
  function getHeader(options: { headers?: HeadersInit }, name: string): string | null {
    return new Headers(options.headers).get(name);
  }

  function mockFetchWithRegistry(makeLlmResponse: () => Response) {
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("model-registry")) {
        return Promise.resolve(emptyRegistryResponse());
      }
      return Promise.resolve(makeLlmResponse());
    });
  }

  const baseOpenAIConfig: LlmCallConfig = {
    model: "gpt-4o-mini",
    prompt: "Say hello",
    temperature: 0.3,
    max_tokens: 100,
  };

  const baseAnthropicConfig: LlmCallConfig = {
    model: "claude-sonnet-4-5",
    prompt: "Say hello",
    max_tokens: 200,
  };

  // Plain (non-structured) completions go through LangChain's `model.stream()`,
  // which issues a streaming request and parses a `text/event-stream` response.
  // These helpers emit the provider-specific SSE event sequence so content and
  // token usage are parsed exactly as against a live provider.
  function openAIResponse(content: string, inputTokens = 10, outputTokens = 5) {
    const sse = [
      `data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ id: "chatcmpl-test", object: "chat.completion.chunk", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens } })}\n\n`,
      "data: [DONE]\n\n",
    ].join("");
    return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
  }

  function anthropicResponse(content: string, inputTokens = 10, outputTokens = 5) {
    const ev = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    const sse = [
      ev("message_start", { type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", model: "claude-sonnet-4-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: inputTokens, output_tokens: 0 } } }),
      ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
      ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: content } }),
      ev("content_block_stop", { type: "content_block_stop", index: 0 }),
      ev("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: outputTokens } }),
      ev("message_stop", { type: "message_stop" }),
    ].join("");
    return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
  }

  // Structured-output completions use `withStructuredOutput().invoke()`, which
  // issues a non-streaming request and parses a JSON body. OpenAI routes this
  // via a `json_schema` response format and returns the object as the message
  // content string.
  function openAIJsonResponse(content: string, inputTokens = 10, outputTokens = 5) {
    return new Response(JSON.stringify({
      id: "chatcmpl-test",
      object: "chat.completion",
      model: "gpt-4o-mini",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
    }), { status: 200, headers: { "content-type": "application/json" } });
  }

  describe("validation", () => {
    it("rejects when model is missing", async () => {
      await expect(
        callLlmAction({ model: "", prompt: "hi" }, {}, "exec-1"),
      ).rejects.toThrow("model");
    });

    it("rejects when prompt is missing", async () => {
      await expect(
        callLlmAction({ model: "gpt-4o", prompt: "" }, {}, "exec-1"),
      ).rejects.toThrow("prompt");
    });
  });

  describe("direct mode — OpenAI", () => {
    it("calls OpenAI API and returns structured result", async () => {
      process.env.OPENAI_API_KEY = "sk-test-key";
      mockFetchWithRegistry(() => openAIResponse("Hello!"));

      const result = await callLlmAction(baseOpenAIConfig, {}, "exec-1");

      expect(result.result).toBe("Hello!");
      expect(result.provider).toBe("openai");
      expect(result.model).toBe("gpt-4o-mini");
      expect(result.input_tokens).toBe(10);
      expect(result.output_tokens).toBe(5);

      const llmCall = mockFetch.mock.calls.find((call: unknown[]) => !(call[0] as string).includes("model-registry"));
      expect(llmCall).toBeDefined();
      const [url, options] = llmCall!;
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      expect(getHeader(options, "authorization")).toBe("Bearer sk-test-key");

      const body = JSON.parse(options.body);
      expect(body.model).toBe("gpt-4o-mini");
      expect(body.messages).toEqual([{ role: "user", content: "Say hello" }]);
      expect(body.temperature).toBe(0.3);
      expect(body.max_tokens).toBe(100);
    });

    it("includes system prompt when provided", async () => {
      process.env.OPENAI_API_KEY = "sk-test";
      mockFetchWithRegistry(() => openAIResponse("Hello"));

      await callLlmAction(
        { ...baseOpenAIConfig, system_prompt: "Be brief" },
        {},
        "exec-1",
      );

      const llmCall = mockFetch.mock.calls.find((call: unknown[]) => !(call[0] as string).includes("model-registry"));
      const body = JSON.parse(llmCall![1].body);
      expect(body.messages[0]).toEqual({ role: "system", content: "Be brief" });
      expect(body.messages[1]).toEqual({ role: "user", content: "Say hello" });
    });

    it("sets json_schema response format when schema provided", async () => {
      process.env.OPENAI_API_KEY = "sk-test";
      mockFetchWithRegistry(() => openAIJsonResponse('{"answer": 42}'));

      await callLlmAction(
        { ...baseOpenAIConfig, response_schema: { type: "object" } },
        {},
        "exec-1",
      );

      const llmCall = mockFetch.mock.calls.find((call: unknown[]) => !(call[0] as string).includes("model-registry"));
      const body = JSON.parse(llmCall![1].body);
      expect(body.response_format.type).toBe("json_schema");
      expect(body.response_format.json_schema).toBeDefined();
    });

    it("rejects when OPENAI_API_KEY is not set", async () => {
      await expect(
        callLlmAction(baseOpenAIConfig, {}, "exec-1"),
      ).rejects.toThrow("OPENAI_API_KEY");
    });

    it("throws on non-200 response", async () => {
      process.env.OPENAI_API_KEY = "sk-test";
      // Use 400 (non-retryable in the provider SDK) so the failure surfaces
      // immediately rather than triggering the SDK's internal retry/backoff.
      mockFetchWithRegistry(() => new Response(
        JSON.stringify({ error: { message: "bad request", type: "invalid_request_error" } }),
        { status: 400, headers: { "content-type": "application/json" } },
      ));

      await expect(
        callLlmAction(baseOpenAIConfig, {}, "exec-1"),
      ).rejects.toThrow("Invalid request");
    });
  });

  describe("direct mode — Anthropic", () => {
    it("calls Anthropic API and returns structured result", async () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";
      mockFetchWithRegistry(() => anthropicResponse("Hi there!"));

      const result = await callLlmAction(baseAnthropicConfig, {}, "exec-1");

      expect(result.result).toBe("Hi there!");
      expect(result.provider).toBe("anthropic");
      expect(result.model).toBe("claude-sonnet-4-5");
      expect(result.input_tokens).toBe(10);
      expect(result.output_tokens).toBe(5);

      const llmCall = mockFetch.mock.calls.find((call: unknown[]) => !(call[0] as string).includes("model-registry"));
      expect(llmCall).toBeDefined();
      const [url, options] = llmCall!;
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      expect(getHeader(options, "x-api-key")).toBe("sk-ant-test");
      expect(getHeader(options, "anthropic-version")).toBe("2023-06-01");
    });

    it("includes system prompt", async () => {
      process.env.ANTHROPIC_API_KEY = "sk-ant-test";
      mockFetchWithRegistry(() => anthropicResponse("OK"));

      await callLlmAction(
        { ...baseAnthropicConfig, system_prompt: "Be concise" },
        {},
        "exec-1",
      );

      const llmCall = mockFetch.mock.calls.find((call: unknown[]) => !(call[0] as string).includes("model-registry"));
      const body = JSON.parse(llmCall![1].body);
      expect(body.system).toBe("Be concise");
    });

    it("rejects when ANTHROPIC_API_KEY is not set", async () => {
      await expect(
        callLlmAction(baseAnthropicConfig, {}, "exec-1"),
      ).rejects.toThrow("ANTHROPIC_API_KEY");
    });
  });

  describe("proxy mode", () => {
    it("routes through proxy when endpoint is set", async () => {
      process.env.STIGMER_PROXY_ENDPOINT = "https://proxy.stigmer.ai";
      process.env.STIGMER_TOKEN = "bearer-token";
      mockFetchWithRegistry(() => openAIResponse("Proxied!"));

      const result = await callLlmAction(baseOpenAIConfig, {}, "exec-1");

      expect(result.result).toBe("Proxied!");
      const llmCall = mockFetch.mock.calls.find((call: unknown[]) => !(call[0] as string).includes("model-registry"));
      expect(llmCall).toBeDefined();
      const [url, options] = llmCall!;
      expect(url).toBe("https://proxy.stigmer.ai/v1/proxy/llm/openai/v1/chat/completions");
      expect(getHeader(options, "authorization")).toBe("Bearer bearer-token");
      expect(getHeader(options, "x-stigmer-workflow-execution-id")).toBe("exec-1");
    });

    it("routes Anthropic through proxy", async () => {
      process.env.STIGMER_PROXY_ENDPOINT = "https://proxy.stigmer.ai";
      process.env.STIGMER_TOKEN = "bearer-token";
      mockFetchWithRegistry(() => anthropicResponse("Proxied!"));

      const result = await callLlmAction(baseAnthropicConfig, {}, "exec-1");

      expect(result.result).toBe("Proxied!");
      const llmCall = mockFetch.mock.calls.find((call: unknown[]) => !(call[0] as string).includes("model-registry"));
      expect(llmCall).toBeDefined();
      const [url] = llmCall!;
      expect(url).toBe("https://proxy.stigmer.ai/v1/proxy/llm/anthropic/v1/messages");
    });
  });

  describe("response schema parsing", () => {
    it("parses JSON when response_schema is set and content is valid JSON", async () => {
      process.env.OPENAI_API_KEY = "sk-test";
      mockFetchWithRegistry(() => openAIJsonResponse('{"answer": 42, "confidence": 0.95}'));

      const result = await callLlmAction(
        { ...baseOpenAIConfig, response_schema: { type: "object" } },
        {},
        "exec-1",
      );

      expect(result.result).toEqual({ answer: 42, confidence: 0.95 });
      expect(result.parse_error).toBeUndefined();
    });

    it("returns plain text when no schema is set", async () => {
      process.env.OPENAI_API_KEY = "sk-test";
      mockFetchWithRegistry(() => openAIResponse("Hello world"));

      const result = await callLlmAction(baseOpenAIConfig, {}, "exec-1");

      expect(result.result).toBe("Hello world");
      expect(result.parse_error).toBeUndefined();
    });
  });

  describe("factory", () => {
    it("creates activities object with CallLlm method", () => {
      const activities = createCallLlmActivities();
      expect(typeof activities.CallLlm).toBe("function");
    });
  });
});
