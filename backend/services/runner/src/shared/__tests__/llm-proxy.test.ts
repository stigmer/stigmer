import { describe, it, expect } from "vitest";
import {
  inferProvider,
  stripProviderPrefix,
  resolveProxyBaseUrl,
  buildProxyHeaders,
} from "../llm-proxy.js";

describe("inferProvider", () => {
  describe("Anthropic models", () => {
    it.each([
      "claude-sonnet-4-20250514",
      "claude-opus-4",
      "claude-haiku-4.5",
      "claude-3.5-sonnet",
      "claude-3-opus-20240229",
      "Claude-Sonnet-4",
    ])("infers anthropic for %s", (model) => {
      expect(inferProvider(model)).toBe("anthropic");
    });
  });

  describe("OpenAI models", () => {
    it.each([
      "gpt-4.1",
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-3.5-turbo",
      "GPT-4.1",
      "o1-preview",
      "o1-mini",
      "o3-mini",
      "o3-pro",
      "o4-mini",
      "chatgpt-4o-latest",
    ])("infers openai for %s", (model) => {
      expect(inferProvider(model)).toBe("openai");
    });
  });

  describe("explicit prefix syntax", () => {
    it("resolves anthropic: prefix", () => {
      expect(inferProvider("anthropic:custom-model")).toBe("anthropic");
    });

    it("resolves openai: prefix", () => {
      expect(inferProvider("openai:ft:gpt-4o:org:suffix")).toBe("openai");
    });

    it("is case-insensitive for the prefix", () => {
      expect(inferProvider("OpenAI:gpt-4o")).toBe("openai");
      expect(inferProvider("Anthropic:claude-sonnet-4")).toBe("anthropic");
    });

    it("does not treat short prefix before colon as provider", () => {
      expect(() => inferProvider("x:model")).toThrow("Cannot determine LLM provider");
    });
  });

  describe("error cases", () => {
    it("throws for empty string", () => {
      expect(() => inferProvider("")).toThrow("Model name is required");
    });

    it("throws for unknown model name", () => {
      expect(() => inferProvider("llama-3.2-70b")).toThrow(
        "Cannot determine LLM provider",
      );
    });

    it("includes the model name in the error message", () => {
      expect(() => inferProvider("mystery-model")).toThrow("mystery-model");
    });

    it("suggests explicit prefix syntax in the error", () => {
      expect(() => inferProvider("deepseek-coder")).toThrow(
        "provider:model-name",
      );
    });
  });
});

describe("stripProviderPrefix", () => {
  it("strips anthropic: prefix", () => {
    expect(stripProviderPrefix("anthropic:claude-sonnet-4")).toBe("claude-sonnet-4");
  });

  it("strips openai: prefix", () => {
    expect(stripProviderPrefix("openai:gpt-4o")).toBe("gpt-4o");
  });

  it("returns original name when no explicit prefix", () => {
    expect(stripProviderPrefix("claude-sonnet-4")).toBe("claude-sonnet-4");
    expect(stripProviderPrefix("gpt-4o")).toBe("gpt-4o");
  });

  it("preserves colons that are part of the model name (ollama format)", () => {
    expect(stripProviderPrefix("qwen2.5-coder:7b")).toBe("qwen2.5-coder:7b");
  });

  it("does not strip unknown provider prefixes", () => {
    expect(stripProviderPrefix("ollama:llama-3.2")).toBe("ollama:llama-3.2");
  });
});

describe("resolveProxyBaseUrl", () => {
  const proxy = "https://api.stigmer.ai";

  it("constructs Anthropic proxy path", () => {
    expect(resolveProxyBaseUrl(proxy, "anthropic")).toBe(
      "https://api.stigmer.ai/v1/proxy/llm/anthropic",
    );
  });

  it("constructs OpenAI proxy path (includes /v1 suffix)", () => {
    expect(resolveProxyBaseUrl(proxy, "openai")).toBe(
      "https://api.stigmer.ai/v1/proxy/llm/openai/v1",
    );
  });

  it("strips trailing slashes from the proxy endpoint", () => {
    expect(resolveProxyBaseUrl("https://api.stigmer.ai///", "anthropic")).toBe(
      "https://api.stigmer.ai/v1/proxy/llm/anthropic",
    );
  });

  it("works with localhost endpoints", () => {
    expect(resolveProxyBaseUrl("http://localhost:7234", "openai")).toBe(
      "http://localhost:7234/v1/proxy/llm/openai/v1",
    );
  });
});

describe("buildProxyHeaders", () => {
  it("includes Authorization bearer token", () => {
    const headers = buildProxyHeaders("tok_abc123");
    expect(headers).toEqual({
      Authorization: "Bearer tok_abc123",
    });
  });

  it("includes X-Stigmer-Execution-Id when provided", () => {
    const headers = buildProxyHeaders("tok_abc", { executionId: "exec-42" });
    expect(headers).toEqual({
      Authorization: "Bearer tok_abc",
      "X-Stigmer-Execution-Id": "exec-42",
    });
  });

  it("includes X-Stigmer-Mcp-Server-Id when provided", () => {
    const headers = buildProxyHeaders("tok_abc", { mcpServerId: "mcp-srv-1" });
    expect(headers).toEqual({
      Authorization: "Bearer tok_abc",
      "X-Stigmer-Mcp-Server-Id": "mcp-srv-1",
    });
  });

  it("includes both scope headers when both provided", () => {
    const headers = buildProxyHeaders("tok_abc", {
      executionId: "exec-42",
      mcpServerId: "mcp-srv-1",
    });
    expect(headers).toEqual({
      Authorization: "Bearer tok_abc",
      "X-Stigmer-Execution-Id": "exec-42",
      "X-Stigmer-Mcp-Server-Id": "mcp-srv-1",
    });
  });

  it("omits scope headers when options are empty strings", () => {
    const headers = buildProxyHeaders("tok_abc", {
      executionId: "",
      mcpServerId: "",
    });
    expect(headers).toEqual({
      Authorization: "Bearer tok_abc",
    });
  });
});
