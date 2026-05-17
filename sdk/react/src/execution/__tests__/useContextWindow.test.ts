import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ContextInfoSchema,
  SummarizationEventSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/context_pb";
import { useContextWindow } from "../useContextWindow";

function makeExecution(overrides?: {
  currentTokenCount?: number;
  contextWindowLimit?: number;
  triggerThreshold?: number;
  targetTokens?: number;
  summarizationEnabled?: boolean;
  utilizationPercent?: number;
}): AgentExecution {
  const exec = create(AgentExecutionSchema);
  const status = create(AgentExecutionStatusSchema);
  const contextInfo = create(ContextInfoSchema);

  contextInfo.currentTokenCount = overrides?.currentTokenCount ?? 10_000;
  contextInfo.contextWindowLimit = overrides?.contextWindowLimit ?? 200_000;
  contextInfo.summarizationTriggerThreshold = overrides?.triggerThreshold ?? 180_000;
  contextInfo.summarizationTargetTokens = overrides?.targetTokens ?? 160_000;
  contextInfo.summarizationEnabled = overrides?.summarizationEnabled ?? true;
  contextInfo.utilizationPercent = overrides?.utilizationPercent ?? 5;

  status.contextInfo = contextInfo;
  exec.status = status;
  return exec;
}

function makeExecutionWithSummarization(): AgentExecution {
  const exec = makeExecution({
    currentTokenCount: 80_000,
    contextWindowLimit: 200_000,
    utilizationPercent: 40,
  });

  const event = create(SummarizationEventSchema);
  event.timestamp = "2026-05-16T10:30:00.000Z";
  event.tokensBefore = 180_000;
  event.tokensAfter = 80_000;
  event.compressionRatio = 0.56;
  event.durationMs = 2300;
  event.summarizationModel = "claude-haiku-4";
  event.messagesBefore = 42;
  event.messagesAfter = 12;
  event.summarizationCostUsd = 0.0008;

  exec.status!.contextInfo!.summarizationEvents.push(event);
  return exec;
}

describe("useContextWindow", () => {
  it("returns empty state when execution is null", () => {
    const { result } = renderHook(() => useContextWindow(null));

    expect(result.current.hasContextInfo).toBe(false);
    expect(result.current.health).toBe("healthy");
    expect(result.current.currentTokenCount).toBe(0);
    expect(result.current.summarizationEvents).toHaveLength(0);
  });

  it("returns empty state when execution has no context_info", () => {
    const exec = create(AgentExecutionSchema);
    exec.status = create(AgentExecutionStatusSchema);

    const { result } = renderHook(() => useContextWindow(exec));

    expect(result.current.hasContextInfo).toBe(false);
  });

  it("returns empty state when context_window_limit is 0", () => {
    const exec = makeExecution({ contextWindowLimit: 0 });

    const { result } = renderHook(() => useContextWindow(exec));

    expect(result.current.hasContextInfo).toBe(false);
  });

  it("extracts context info correctly for healthy utilization", () => {
    const exec = makeExecution({
      currentTokenCount: 42_000,
      contextWindowLimit: 200_000,
      triggerThreshold: 180_000,
      targetTokens: 160_000,
      utilizationPercent: 21,
    });

    const { result } = renderHook(() => useContextWindow(exec));

    expect(result.current.hasContextInfo).toBe(true);
    expect(result.current.currentTokenCount).toBe(42_000);
    expect(result.current.contextWindowLimit).toBe(200_000);
    expect(result.current.utilizationPercent).toBe(21);
    expect(result.current.triggerThreshold).toBe(180_000);
    expect(result.current.targetTokens).toBe(160_000);
    expect(result.current.summarizationEnabled).toBe(true);
    expect(result.current.health).toBe("healthy");
    expect(result.current.isNearThreshold).toBe(false);
  });

  it("returns warning health for 70-90% utilization", () => {
    const exec = makeExecution({ utilizationPercent: 75 });

    const { result } = renderHook(() => useContextWindow(exec));

    expect(result.current.health).toBe("warning");
  });

  it("returns critical health for 90%+ utilization", () => {
    const exec = makeExecution({ utilizationPercent: 92 });

    const { result } = renderHook(() => useContextWindow(exec));

    expect(result.current.health).toBe("critical");
  });

  it("detects near-threshold correctly", () => {
    const exec = makeExecution({
      currentTokenCount: 172_000,
      contextWindowLimit: 200_000,
      triggerThreshold: 180_000,
      utilizationPercent: 86,
    });

    const { result } = renderHook(() => useContextWindow(exec));

    expect(result.current.isNearThreshold).toBe(true);
  });

  it("maps summarization events correctly", () => {
    const exec = makeExecutionWithSummarization();

    const { result } = renderHook(() => useContextWindow(exec));

    expect(result.current.summarizationEvents).toHaveLength(1);

    const event = result.current.summarizationEvents[0];
    expect(event.tokensBefore).toBe(180_000);
    expect(event.tokensAfter).toBe(80_000);
    expect(event.compressionRatio).toBeCloseTo(0.56);
    expect(event.durationMs).toBe(2300);
    expect(event.model).toBe("claude-haiku-4");
    expect(event.messagesBefore).toBe(42);
    expect(event.messagesAfter).toBe(12);
    expect(event.costUsd).toBeCloseTo(0.0008);
  });

  it("returns stable reference across re-renders with same input", () => {
    const exec = makeExecution();
    const { result, rerender } = renderHook(() => useContextWindow(exec));

    const first = result.current;
    rerender();
    const second = result.current;

    expect(second).toBe(first);
  });
});
