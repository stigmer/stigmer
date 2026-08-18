import { describe, expect, it } from "vitest";
import type { Config } from "../../config/config.js";
import { readLlm } from "../llm-config.js";
import { readOperator } from "../operator-config.js";
import {
  PROVIDER_CHOICES,
  applyChoice,
  applyOperatorIdentity,
  buildLlmForChoice,
  buildOperatorForInputs,
} from "./wizard.js";

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
  it("persists provider and key only — there is no model concept, the registry owns it (oss#314)", () => {
    expect(buildLlmForChoice("anthropic")).toEqual({ provider: "anthropic" });
    expect(buildLlmForChoice("anthropic", { apiKey: "k" })).toEqual({
      provider: "anthropic",
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

describe("buildOperatorForInputs", () => {
  it("persists email (and optional name), trimmed", () => {
    expect(buildOperatorForInputs(" ada@example.com ", "")).toEqual({ email: "ada@example.com" });
    expect(buildOperatorForInputs("ada@example.com", " Ada ")).toEqual({
      email: "ada@example.com",
      name: "Ada",
    });
  });

  it("returns undefined for empty inputs — nothing to persist, identity stays anonymous", () => {
    expect(buildOperatorForInputs("", "")).toBeUndefined();
    expect(buildOperatorForInputs("  ", "")).toBeUndefined();
  });

  // The server's boot rules, surfaced at setup time (oss#796): a malformed
  // identity must never be persisted only to fail the next `stigmer up`.
  it("refuses what the server's boot check would refuse", () => {
    expect(() => buildOperatorForInputs("not-an-email", "")).toThrow(/missing '@'/);
    expect(() => buildOperatorForInputs("", "Ada")).toThrow(/set both or neither/);
  });
});

describe("applyOperatorIdentity", () => {
  it("writes the identity while preserving siblings", () => {
    const cfg = config({ temporal: { managed: true }, llm: { provider: "anthropic" } });
    const updated = applyOperatorIdentity(cfg, "ada@example.com", "Ada");
    expect(readOperator(updated)).toEqual({ email: "ada@example.com", name: "Ada" });
    expect(readLlm(updated)).toEqual({ provider: "anthropic" });
    expect((updated.backend.local as { temporal: unknown }).temporal).toEqual({ managed: true });
  });

  it("empty inputs leave the config unchanged (skip, not clear)", () => {
    const cfg = config({ operator: { email: "keep@example.com" } });
    const updated = applyOperatorIdentity(cfg, "", "");
    expect(readOperator(updated)).toEqual({ email: "keep@example.com" });
  });
});
