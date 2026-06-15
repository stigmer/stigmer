import { describe, expect, it } from "vitest";
import type { Config } from "../../config/config.js";
import { readLlm } from "../llm-config.js";
import { applyChoice, buildLlmForChoice } from "./wizard.js";

function config(local?: unknown): Config {
  return { backend: { type: "local", local } };
}

describe("buildLlmForChoice", () => {
  it("applies provider defaults and overrides", () => {
    expect(buildLlmForChoice("anthropic")).toEqual({ provider: "anthropic", model: "claude-sonnet-4.5" });
    expect(buildLlmForChoice("anthropic", { apiKey: "k", model: "m" })).toEqual({
      provider: "anthropic",
      model: "m",
      api_key: "k",
    });
    expect(buildLlmForChoice("ollama", { baseUrl: "http://host:1" })).toEqual({
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      base_url: "http://host:1",
    });
  });

  it("returns undefined for skip (clears config)", () => {
    expect(buildLlmForChoice("skip")).toBeUndefined();
  });
});

describe("applyChoice", () => {
  it("writes the selection while preserving siblings", () => {
    const cfg = config({ temporal: { managed: true }, llm: { provider: "openai" } });
    const updated = applyChoice(cfg, "anthropic", { apiKey: "k" });
    expect(readLlm(updated)).toEqual({ provider: "anthropic", model: "claude-sonnet-4.5", api_key: "k" });
    expect((updated.backend.local as { temporal: unknown }).temporal).toEqual({ managed: true });
  });

  it("skip clears the llm section", () => {
    const updated = applyChoice(config({ llm: { provider: "openai" } }), "skip");
    expect(readLlm(updated)).toBeUndefined();
  });
});
