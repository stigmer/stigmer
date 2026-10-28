// The CLI's copy of the runner's reach rule (local/provider-reach.ts), held
// on its own arms: a proxy reaches every provider and wins over settings the
// runner would refuse; any setting the runner refuses at boot reaches
// nothing; a gateway address is trimmed and must be http(s); a backend
// without its prerequisites reaches nothing; the setting's value and the
// readable line join the reach in order. The runner's own suite holds this
// copy equal to the runner's rule over a matrix of environments
// (backend/services/runner/src/shared/__tests__/provider-reach.test.ts).
import { describe, expect, it } from "vitest";

import { describeReach, providerReach, runnerProvidersValue } from "../provider-reach.js";

describe("providerReach", () => {
  it("reaches every provider through a proxy, even beside a backend the runner would refuse", () => {
    const all = [
      { provider: "anthropic", via: "proxy" },
      { provider: "openai", via: "proxy" },
      { provider: "cursor", via: "proxy" },
    ];
    expect(providerReach({ STIGMER_PROXY_ENDPOINT: "https://proxy.example" })).toEqual(all);
    expect(providerReach({ STIGMER_PROXY_ENDPOINT: "https://proxy.example", STIGMER_ANTHROPIC_BACKEND: "nope" })).toEqual(
      all,
    );
  });

  it("does not read a blank proxy address as a proxy", () => {
    expect(providerReach({ STIGMER_PROXY_ENDPOINT: "   ", ANTHROPIC_API_KEY: "sk-ant" })).toEqual([
      { provider: "anthropic", via: "key" },
    ]);
  });

  it("reaches nothing when the runner would refuse to boot on its settings", () => {
    const keys = { ANTHROPIC_API_KEY: "sk-ant", OPENAI_API_KEY: "sk-oa", CURSOR_API_KEY: "key_c" };
    expect(providerReach({ ...keys, STIGMER_ANTHROPIC_BACKEND: "azure" })).toEqual([]);
    expect(providerReach({ ...keys, STIGMER_OPENAI_BACKEND: "azure" })).toEqual([]);
    expect(providerReach({ ...keys, ANTHROPIC_BASE_URL: "not a url" })).toEqual([]);
    expect(providerReach({ ...keys, ANTHROPIC_BASE_URL: "ftp://gateway.example" })).toEqual([]);
    expect(providerReach({ ...keys, STIGMER_ANTHROPIC_BACKEND: "vertex" })).toEqual([]);
  });

  it("reaches Anthropic through a gateway whose address is trimmed, and every key it holds", () => {
    expect(
      providerReach({
        ANTHROPIC_BASE_URL: "  http://gateway.example  ",
        OPENAI_API_KEY: "sk-oa",
        CURSOR_API_KEY: "key_c",
      }),
    ).toEqual([
      { provider: "anthropic", via: "gateway" },
      { provider: "openai", via: "key" },
      { provider: "cursor", via: "key" },
    ]);
  });

  it("reaches Anthropic through a backend whose prerequisites hold, ahead of a key", () => {
    expect(
      providerReach({ STIGMER_ANTHROPIC_BACKEND: " Vertex ", CLOUD_ML_REGION: "us-east5", ANTHROPIC_API_KEY: "sk-ant" }),
    ).toEqual([{ provider: "anthropic", via: "vertex" }]);
  });

  it("reaches nothing with no settings at all", () => {
    expect(providerReach({})).toEqual([]);
  });
});

describe("the reach, written out", () => {
  const reach = [
    { provider: "anthropic", via: "vertex" },
    { provider: "cursor", via: "key" },
  ] as const;

  it("is the setting's value: the providers' names, comma-separated", () => {
    expect(runnerProvidersValue(reach)).toBe("anthropic,cursor");
    expect(runnerProvidersValue([])).toBe("");
  });

  it("is a line a person reads: each provider with its route", () => {
    expect(describeReach(reach)).toBe("anthropic (vertex), cursor (key)");
    expect(describeReach([])).toBe("");
  });
});
