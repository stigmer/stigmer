/**
 * The native execution turn's request against the REAL @langchain/anthropic
 * (stigmer/stigmer#1341): the unit suite in model-client.test.ts mocks the
 * wrapper, so it cannot see the wrapper's own parameter validation. That
 * validation is what failed every native turn on claude-opus-4.7,
 * claude-opus-4.8 and claude-fable-5 while the runner pinned temperature 0.
 * These tests build the client the way the execution turn does and read the
 * request parameters offline; no request leaves the process.
 */
import { ChatAnthropic } from "@langchain/anthropic";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildChatModel } from "../model-client.js";
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
