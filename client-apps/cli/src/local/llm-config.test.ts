import { describe, expect, it } from "vitest";
import type { Config } from "../config/config.js";
import {
  detectProviderFromEnv,
  readLlm,
  resolveApiKey,
  resolveModel,
  resolveProvider,
  setLlm,
  withProviderDefaults,
} from "./llm-config.js";

function config(local?: unknown): Config {
  return { backend: { type: "local", local } };
}

describe("detectProviderFromEnv", () => {
  it("prefers Anthropic, then OpenAI, else empty", () => {
    expect(detectProviderFromEnv({ ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "b" })).toBe("anthropic");
    expect(detectProviderFromEnv({ OPENAI_API_KEY: "b" })).toBe("openai");
    expect(detectProviderFromEnv({})).toBe("");
  });
});

describe("resolveProvider", () => {
  it("honors env override > config > autodetect", () => {
    const cfg = config({ llm: { provider: "ollama" } });
    expect(resolveProvider(cfg, { STIGMER_LLM_PROVIDER: "openai" })).toBe("openai");
    expect(resolveProvider(cfg, {})).toBe("ollama");
    expect(resolveProvider(config(), { ANTHROPIC_API_KEY: "x" })).toBe("anthropic");
    expect(resolveProvider(config(), {})).toBe("");
  });
});

describe("resolveModel", () => {
  it("falls back to the provider default", () => {
    expect(resolveModel(config({ llm: { provider: "anthropic" } }), {})).toBe("claude-sonnet-4.5");
    expect(resolveModel(config({ llm: { provider: "openai" } }), {})).toBe("gpt-4");
    expect(resolveModel(config({ llm: { provider: "ollama" } }), {})).toBe("qwen2.5-coder:7b");
    expect(resolveModel(config({ llm: { provider: "anthropic", model: "claude-x" } }), {})).toBe("claude-x");
    expect(resolveModel(config({ llm: { provider: "anthropic" } }), { STIGMER_LLM_MODEL: "envm" })).toBe("envm");
  });
});

describe("resolveApiKey", () => {
  it("uses the provider-specific env var, then config", () => {
    const cfg = config({ llm: { provider: "anthropic", api_key: "cfgkey" } });
    expect(resolveApiKey(cfg, { ANTHROPIC_API_KEY: "envkey" })).toBe("envkey");
    expect(resolveApiKey(cfg, {})).toBe("cfgkey");
  });
});

describe("withProviderDefaults", () => {
  it("fills model and base URL per provider, keeping api_key only when set", () => {
    expect(withProviderDefaults({ provider: "anthropic" })).toEqual({ provider: "anthropic", model: "claude-sonnet-4.5" });
    expect(withProviderDefaults({ provider: "ollama" })).toEqual({
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      base_url: "http://localhost:11434",
    });
    expect(withProviderDefaults({ provider: "openai", api_key: "k" })).toEqual({
      provider: "openai",
      model: "gpt-4",
      api_key: "k",
    });
  });
});

describe("setLlm", () => {
  it("preserves sibling local keys and can clear the section", () => {
    const cfg = config({ temporal: { managed: true }, llm: { provider: "openai" } });
    const updated = setLlm(cfg, { provider: "anthropic", model: "m" });
    expect(readLlm(updated)).toEqual({ provider: "anthropic", model: "m" });
    expect((updated.backend.local as { temporal: unknown }).temporal).toEqual({ managed: true });

    const cleared = setLlm(cfg, undefined);
    expect(readLlm(cleared)).toBeUndefined();
    expect((cleared.backend.local as { temporal: unknown }).temporal).toEqual({ managed: true });
  });
});
