import { describe, expect, it } from "vitest";
import type { Config } from "../config/config.js";
import {
  detectProviderFromEnv,
  readLlm,
  resolveApiKey,
  resolveModel,
  resolveProvider,
  setLlm,
} from "./llm-config.js";

function config(local?: unknown): Config {
  return { backend: { type: "local", local } };
}

describe("detectProviderFromEnv", () => {
  it("detects Anthropic only — the sole provider local execution supports", () => {
    expect(detectProviderFromEnv({ ANTHROPIC_API_KEY: "a" })).toBe("anthropic");
    // Other provider keys in the shell must not flip the local story.
    expect(detectProviderFromEnv({ OPENAI_API_KEY: "b" })).toBe("");
    expect(detectProviderFromEnv({})).toBe("");
  });
});

describe("resolveProvider", () => {
  it("honors env override > config > autodetect", () => {
    const cfg = config({ llm: { provider: "anthropic" } });
    expect(resolveProvider(cfg, { STIGMER_LLM_PROVIDER: "other" })).toBe("other");
    expect(resolveProvider(cfg, {})).toBe("anthropic");
    expect(resolveProvider(config(), { ANTHROPIC_API_KEY: "x" })).toBe("anthropic");
    expect(resolveProvider(config(), {})).toBe("");
  });
});

describe("resolveModel", () => {
  it("returns the explicit override, else empty — the registry owns the default", () => {
    // No hardcoded model version anywhere in the CLI: unset means "platform
    // default", resolved by the runner from the model registry.
    expect(resolveModel(config({ llm: { provider: "anthropic" } }), {})).toBe("");
    expect(resolveModel(config(), {})).toBe("");
    expect(resolveModel(config({ llm: { provider: "anthropic", model: "claude-x" } }), {})).toBe("claude-x");
    expect(resolveModel(config({ llm: { provider: "anthropic" } }), { STIGMER_LLM_MODEL: "envm" })).toBe("envm");
  });
});

describe("resolveApiKey", () => {
  it("uses ANTHROPIC_API_KEY, then config", () => {
    const cfg = config({ llm: { provider: "anthropic", api_key: "cfgkey" } });
    expect(resolveApiKey(cfg, { ANTHROPIC_API_KEY: "envkey" })).toBe("envkey");
    expect(resolveApiKey(cfg, {})).toBe("cfgkey");
  });

  it("returns empty for non-anthropic providers (e.g. hand-edited config)", () => {
    expect(resolveApiKey(config({ llm: { provider: "other", api_key: "k" } }), {})).toBe("");
  });
});

describe("setLlm", () => {
  it("preserves sibling local keys and can clear the section", () => {
    const cfg = config({ temporal: { managed: true }, llm: { provider: "anthropic" } });
    const updated = setLlm(cfg, { provider: "anthropic", model: "m" });
    expect(readLlm(updated)).toEqual({ provider: "anthropic", model: "m" });
    expect((updated.backend.local as { temporal: unknown }).temporal).toEqual({ managed: true });

    const cleared = setLlm(cfg, undefined);
    expect(readLlm(cleared)).toBeUndefined();
    expect((cleared.backend.local as { temporal: unknown }).temporal).toEqual({ managed: true });
  });
});
