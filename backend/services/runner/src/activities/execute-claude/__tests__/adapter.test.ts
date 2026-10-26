/**
 * Pins the Claude adapter's own half (`adapter.ts`): a runner whose engine
 * failed to load still boots, and every Claude turn on it fails
 * `actionable` with the not-installed message before anything runs; a
 * runner whose engine loaded hands each turn to the turn module with the
 * config slice taken at boot; and nothing is held per session or across
 * turns.
 *
 * Why it matters: the engine ships with no published runner yet, and one
 * engine's missing package must never take a worker's other engines down
 * with it. The SDK and the turn module are mocked per test (`vi.doMock`)
 * because the adapter imports both dynamically inside `boot`.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

import { testConfig } from "../../../__test-utils__/config-fixture.js";
import { RecordingTurnSink } from "../../../__test-utils__/harness-contract/recording-sink.js";
import { turnInputFixture } from "../../../__test-utils__/turn-input-fixture.js";
import type { TurnInput, TurnOutcome, TurnSink } from "../../../harness/types.js";
import type { ClaudeAdapterConfig, ClaudeSdk } from "../turn.js";

const SDK = "@anthropic-ai/claude-agent-sdk";

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.doUnmock(SDK);
  vi.doUnmock("../turn.js");
  vi.restoreAllMocks();
});

async function loadAdapter(): Promise<typeof import("../adapter.js")> {
  return import("../adapter.js");
}

describe("the Claude adapter on a runner without the engine", () => {
  it("boots, warning once, and fails every turn actionable with the not-installed message", async () => {
    vi.doMock(SDK, () => {
      throw new Error("Cannot find package '@anthropic-ai/claude-agent-sdk'");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { createClaudeAdapter, NOT_INSTALLED_MESSAGE } = await loadAdapter();
    const adapter = createClaudeAdapter();

    await expect(adapter.boot(testConfig())).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("[claude] the Claude engine is not installed on this runner; Claude turns will be refused:");

    const outcome = await adapter.runTurn(turnInputFixture({ message: "hello" }), new RecordingTurnSink());
    expect(outcome).toEqual({ kind: "failed", surface: "actionable", message: NOT_INSTALLED_MESSAGE });
    expect(NOT_INSTALLED_MESSAGE).toBe("Claude is not installed on this runner, so this turn cannot run on Claude. Run it on another engine.");
  });

});

describe("the Claude adapter on a runner with the engine", () => {
  it("hands each turn to the turn module with the config slice taken at boot and the loaded SDK", async () => {
    const fakeSdk = { marker: "the loaded sdk" };
    vi.doMock(SDK, () => fakeSdk);
    const seen: { input: TurnInput; sink: TurnSink; config: ClaudeAdapterConfig; sdk: ClaudeSdk }[] = [];
    const outcome: TurnOutcome = { kind: "completed" };
    vi.doMock("../turn.js", () => ({
      runClaudeTurn: async (input: TurnInput, sink: TurnSink, config: ClaudeAdapterConfig, sdk: ClaudeSdk): Promise<TurnOutcome> => {
        seen.push({ input, sink, config, sdk });
        return outcome;
      },
    }));
    const { createClaudeAdapter, resolveClaudeConfig } = await loadAdapter();
    const adapter = createClaudeAdapter();
    const config = testConfig({ mode: "cloud", shellTimeoutMaxSeconds: 77 });
    await adapter.boot(config);

    const input = turnInputFixture({ message: "hello" });
    const sink = new RecordingTurnSink();
    await expect(adapter.runTurn(input, sink)).resolves.toBe(outcome);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.input).toBe(input);
    expect(seen[0]?.sink).toBe(sink);
    expect(seen[0]?.config).toEqual(resolveClaudeConfig(config));
    expect(seen[0]?.sdk).toMatchObject({ marker: "the loaded sdk" });
  });
});

describe("the Claude adapter's lifetime", () => {
  it("refuses a turn before boot with a thrown error naming the registry's order", async () => {
    const { createClaudeAdapter } = await loadAdapter();
    await expect(createClaudeAdapter().runTurn(turnInputFixture(), new RecordingTurnSink())).rejects.toThrow(
      "claude adapter: runTurn before boot (the registry boots every adapter before the worker polls)",
    );
  });

  it("holds nothing: releasing any session and shutting down are no-ops", async () => {
    const { createClaudeAdapter } = await loadAdapter();
    const adapter = createClaudeAdapter();
    await expect(adapter.releaseSession("ses_unknown")).resolves.toBeUndefined();
    await expect(adapter.shutdown()).resolves.toBeUndefined();
  });

  it("is named claude and declares the Claude capabilities", async () => {
    const { createClaudeAdapter } = await loadAdapter();
    const { CLAUDE_CAPABILITIES } = await import("../claude-capabilities.js");
    const adapter = createClaudeAdapter();
    expect(adapter.name).toBe("claude");
    expect(adapter.capabilities).toBe(CLAUDE_CAPABILITIES);
  });
});

describe("resolveClaudeConfig", () => {
  it("takes exactly the slice a Claude turn reads", async () => {
    const { resolveClaudeConfig } = await loadAdapter();
    const tokenRef = { current: "tok" };
    const config = testConfig({
      checkpointerType: "http",
      checkpointerProxyEndpoint: "http://127.0.0.1:9/checkpoints",
      stigmerTokenRef: tokenRef,
      proxyEndpoint: "http://127.0.0.1:9/proxy",
      shellTimeoutMaxSeconds: 600,
      mode: "cloud",
      cursorStreamStallTimeoutMs: 240_000,
    });
    const slice = resolveClaudeConfig(config);
    expect(slice).toEqual({
      checkpointerType: "http",
      checkpointerProxyEndpoint: "http://127.0.0.1:9/checkpoints",
      stigmerTokenRef: tokenRef,
      proxyEndpoint: "http://127.0.0.1:9/proxy",
      shellTimeoutMaxSeconds: 600,
      mode: "cloud",
      cursorStreamStallTimeoutMs: 240_000,
    });
    expect(slice.stigmerTokenRef).toBe(tokenRef);
  });
});
