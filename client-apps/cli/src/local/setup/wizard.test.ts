import { describe, expect, it } from "vitest";
import type { Config } from "../../config/config.js";
import { readLlm } from "../llm-config.js";
import { PROVIDER_CHOICES, applyChoice, buildLlmForChoice } from "./wizard.js";

function config(local?: unknown): Config {
  return { backend: { type: "local", local } };
}

// Regression pin: every provider offered by `stigmer setup` promises an
// execution path the native runner must actually serve. The runner constructs
// Anthropic clients only and the registry's native-harness entries are all
// Anthropic — so this list is anthropic + skip, full stop. If this test fails
// because a provider was added, the native runner and model registry must gain
// real support for it first (see sdk/react DISABLED_PROVIDERS for the same
// decision on the UI side).
describe("PROVIDER_CHOICES", () => {
  it("offers exactly anthropic and skip", () => {
    expect([...PROVIDER_CHOICES]).toEqual(["anthropic", "skip"]);
  });
});

describe("buildLlmForChoice", () => {
  it("persists no model unless explicitly overridden — the registry owns the default", () => {
    expect(buildLlmForChoice("anthropic")).toEqual({ provider: "anthropic" });
    expect(buildLlmForChoice("anthropic", { apiKey: "k", model: "m" })).toEqual({
      provider: "anthropic",
      model: "m",
      api_key: "k",
    });
  });

  it("returns undefined for skip (clears config)", () => {
    expect(buildLlmForChoice("skip")).toBeUndefined();
  });
});

describe("applyChoice", () => {
  it("writes the selection while preserving siblings", () => {
    const cfg = config({ temporal: { managed: true }, llm: { provider: "anthropic", model: "stale" } });
    const updated = applyChoice(cfg, "anthropic", { apiKey: "k" });
    expect(readLlm(updated)).toEqual({ provider: "anthropic", api_key: "k" });
    expect((updated.backend.local as { temporal: unknown }).temporal).toEqual({ managed: true });
  });

  it("skip clears the llm section", () => {
    const updated = applyChoice(config({ llm: { provider: "anthropic" } }), "skip");
    expect(readLlm(updated)).toBeUndefined();
  });
});
