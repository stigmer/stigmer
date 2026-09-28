/**
 * The native execution turn's request against the REAL @langchain/anthropic
 * (stigmer/stigmer#1341): the unit suite in model-client.test.ts mocks the
 * wrapper, so it cannot see the wrapper's own parameter validation. That
 * validation is what failed every native turn on claude-opus-4.7,
 * claude-opus-4.8 and claude-fable-5 while the runner pinned temperature 0.
 * These tests build the client the way the execution turn does and read the
 * request parameters offline; no request leaves the process. The same holds
 * for the thinking parameter and the output ceiling the turn now sends: the
 * wrapper's own handling of them (sent only when set, sampling stripped
 * under thinking) is what reaches the provider.
 */
import { ChatAnthropic } from "@langchain/anthropic";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildChatModel, type BuildChatModelOptions } from "../model-client.js";
import { BUDGET_THINKING_TOKENS } from "../thinking-mode.js";
import { _resetRegistryCache } from "../model-registry.js";

// Ids the wrapper treats as adaptive-only and refuses a sampling override
// for, and ids it lets one through for (the provider itself refuses it on
// claude-sonnet-5); the registry is unreachable in these tests, so each id
// reaches the wrapper unchanged.
const ADAPTIVE_ONLY_IDS = ["claude-opus-4-7", "claude-opus-4-8", "claude-fable-5"];
const SAMPLING_TOLERANT_IDS = ["claude-sonnet-4-6", "claude-opus-4-6", "claude-sonnet-5", "claude-haiku-4-5-20251001"];

async function executionTurnParams(modelName: string, temperature: number | null | undefined) {
  const { model } = await buildChatModel({
    modelName,
    proxyEndpoint: "http://127.0.0.1:9",
    stigmerToken: "sampling-test",
    temperature,
  });
  return (model as ChatAnthropic).invocationParams({});
}

describe("the native execution turn's sampling parameters (real @langchain/anthropic)", () => {
  beforeEach(() => {
    _resetRegistryCache();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("registry unreachable in this test"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    _resetRegistryCache();
    vi.restoreAllMocks();
  });

  it.each(ADAPTIVE_ONLY_IDS)("%s: the pinned temperature 0 is refused before any request", async (id) => {
    await expect(executionTurnParams(id, undefined)).rejects.toThrow(/temperature is not supported/);
  });

  it.each([...ADAPTIVE_ONLY_IDS, ...SAMPLING_TOLERANT_IDS])(
    "%s: with no temperature the request builds and carries no sampling override",
    async (id) => {
      const params = await executionTurnParams(id, null);
      expect(params).not.toHaveProperty("temperature");
    },
  );
});

describe("the native execution turn's thinking and ceiling (real @langchain/anthropic)", () => {
  beforeEach(() => {
    _resetRegistryCache();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("registry unreachable in this test"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    _resetRegistryCache();
    vi.restoreAllMocks();
  });

  async function params(modelName: string, extra: Partial<BuildChatModelOptions>) {
    const { model } = await buildChatModel({
      modelName,
      proxyEndpoint: "http://127.0.0.1:9",
      stigmerToken: "sampling-test",
      temperature: null,
      ...extra,
    });
    return (model as ChatAnthropic).invocationParams({});
  }

  it.each(ADAPTIVE_ONLY_IDS)("%s: adaptive thinking with summarized display reaches the request", async (id) => {
    const request = await params(id, { thinking: { type: "adaptive", display: "summarized" } });
    expect(request.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(request).not.toHaveProperty("temperature");
  });

  it("a budget row's fixed budget reaches the request below the row's ceiling", async () => {
    const request = await params("claude-haiku-4-5-20251001", {
      thinking: { type: "enabled", budget_tokens: BUDGET_THINKING_TOKENS },
      maxTokens: 64000,
      streaming: true,
    });
    expect(request.thinking).toEqual({ type: "enabled", budget_tokens: BUDGET_THINKING_TOKENS });
    expect(request.max_tokens).toBe(64000);
  });

  it("an explicit disabled is sent as such, and an omitted one is not sent at all", async () => {
    expect((await params("claude-sonnet-5", { thinking: { type: "disabled" } })).thinking).toEqual({ type: "disabled" });
    expect((await params("claude-sonnet-5", {})).thinking).toBeUndefined();
  });

  it("the row's full ceiling builds with streaming on, where the library default would be 4096", async () => {
    expect((await params("claude-sonnet-5", {})).max_tokens).toBe(4096);
    expect((await params("claude-sonnet-5", { maxTokens: 128000, streaming: true })).max_tokens).toBe(128000);
  });
});
