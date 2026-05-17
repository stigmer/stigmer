import { describe, it, expect } from "vitest";
import { buildTurnBillingInput, type BillingRecordParams } from "../execute-cursor.js";
import type { TurnRecord } from "../../adapter/usage-accumulator.js";

function makeTurn(overrides: Partial<TurnRecord> = {}): TurnRecord {
  return {
    sequence: 1,
    inputTokens: 500,
    outputTokens: 200,
    cacheReadTokens: 100,
    cacheWriteTokens: 50,
    ...overrides,
  };
}

describe("buildTurnBillingInput", () => {
  const baseParams: Omit<BillingRecordParams, "turn"> = {
    executionId: "exec-123",
    requestedModel: "claude-sonnet-4-6",
  };

  it("uses sdkResolvedModel as resolvedModel when provided", () => {
    const input = buildTurnBillingInput({
      ...baseParams,
      turn: makeTurn(),
      sdkResolvedModel: "claude-sonnet-4-6-20260501",
    });

    expect(input.resolvedModel).toBe("claude-sonnet-4-6-20260501");
    expect(input.requestedModel).toBe("claude-sonnet-4-6");
  });

  it("falls back to requestedModel when sdkResolvedModel is undefined", () => {
    const input = buildTurnBillingInput({
      ...baseParams,
      turn: makeTurn(),
      sdkResolvedModel: undefined,
    });

    expect(input.resolvedModel).toBe("claude-sonnet-4-6");
    expect(input.requestedModel).toBe("claude-sonnet-4-6");
  });

  it("falls back to requestedModel when sdkResolvedModel is empty string", () => {
    const input = buildTurnBillingInput({
      ...baseParams,
      turn: makeTurn(),
      sdkResolvedModel: "",
    });

    expect(input.resolvedModel).toBe("claude-sonnet-4-6");
    expect(input.requestedModel).toBe("claude-sonnet-4-6");
  });

  it("sets requestedModel to config model regardless of sdkResolvedModel", () => {
    const withSdk = buildTurnBillingInput({
      ...baseParams,
      turn: makeTurn(),
      sdkResolvedModel: "different-model",
    });
    const withoutSdk = buildTurnBillingInput({
      ...baseParams,
      turn: makeTurn(),
    });

    expect(withSdk.requestedModel).toBe("claude-sonnet-4-6");
    expect(withoutSdk.requestedModel).toBe("claude-sonnet-4-6");
  });

  it("maps token fields correctly", () => {
    const turn = makeTurn({
      inputTokens: 1000,
      outputTokens: 500,
      cacheWriteTokens: 200,
      cacheReadTokens: 300,
    });
    const input = buildTurnBillingInput({ ...baseParams, turn });

    expect(input.tokens!.inputTokens).toBe(BigInt(1000));
    expect(input.tokens!.outputTokens).toBe(BigInt(500));
    expect(input.tokens!.cacheCreationInputTokens).toBe(BigInt(200));
    expect(input.tokens!.cacheReadInputTokens).toBe(BigInt(300));
  });

  it("sets static fields: provider, harness, streaming, usageStatus", () => {
    const input = buildTurnBillingInput({ ...baseParams, turn: makeTurn() });

    expect(input.provider).toBe("cursor");
    expect(input.harness).toBe("cursor");
    expect(input.streaming).toBe(true);
  });

  it("preserves executionId and sequence", () => {
    const input = buildTurnBillingInput({
      ...baseParams,
      turn: makeTurn({ sequence: 3 }),
    });

    expect(input.executionId).toBe("exec-123");
    expect(input.sequence).toBe(3);
  });

  it("handles 'default' model with SDK-resolved actual model", () => {
    const input = buildTurnBillingInput({
      executionId: "exec-456",
      turn: makeTurn(),
      requestedModel: "default",
      sdkResolvedModel: "composer-2",
    });

    expect(input.requestedModel).toBe("default");
    expect(input.resolvedModel).toBe("composer-2");
  });
});
