import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
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
import { ContextGauge } from "../components/ContextGauge.js";

function makeExecution(overrides?: {
  currentTokenCount?: number;
  contextWindowLimit?: number;
  utilizationPercent?: number;
}): AgentExecution {
  const exec = create(AgentExecutionSchema);
  const status = create(AgentExecutionStatusSchema);
  const contextInfo = create(ContextInfoSchema);

  contextInfo.currentTokenCount = overrides?.currentTokenCount ?? 10_000;
  contextInfo.contextWindowLimit = overrides?.contextWindowLimit ?? 128_000;
  contextInfo.summarizationTriggerThreshold = 115_200;
  contextInfo.summarizationTargetTokens = 102_400;
  contextInfo.summarizationEnabled = true;
  contextInfo.utilizationPercent = overrides?.utilizationPercent ?? 5;

  status.contextInfo = contextInfo;
  exec.status = status;
  return exec;
}

function addSummarizationEvent(
  exec: AgentExecution,
  overrides?: {
    tokensBefore?: number;
    tokensAfter?: number;
    compressionRatio?: number;
    durationMs?: number;
    model?: string;
    costUsd?: number;
  },
): void {
  const event = create(SummarizationEventSchema);
  event.timestamp = "2026-05-17T10:30:00.000Z";
  event.tokensBefore = overrides?.tokensBefore ?? 120_000;
  event.tokensAfter = overrides?.tokensAfter ?? 82_000;
  event.compressionRatio = overrides?.compressionRatio ?? 0.32;
  event.durationMs = overrides?.durationMs ?? 2100;
  event.summarizationModel = overrides?.model ?? "claude-haiku-4";
  event.messagesBefore = 30;
  event.messagesAfter = 10;
  event.summarizationCostUsd = overrides?.costUsd ?? 0.02;

  exec.status!.contextInfo!.summarizationEvents.push(event);
}

describe("ContextGauge", () => {
  it("renders nothing when execution is null", () => {
    const { lastFrame } = render(<ContextGauge execution={null} />);
    expect(lastFrame()).toBe("");
  });

  it("renders nothing when contextInfo is absent", () => {
    const exec = create(AgentExecutionSchema);
    exec.status = create(AgentExecutionStatusSchema);

    const { lastFrame } = render(<ContextGauge execution={exec} />);
    expect(lastFrame()).toBe("");
  });

  it("renders healthy gauge with green bar and no health label", () => {
    const exec = makeExecution({
      currentTokenCount: 51_200,
      contextWindowLimit: 128_000,
      utilizationPercent: 40,
    });

    const { lastFrame } = render(<ContextGauge execution={exec} />);
    const output = lastFrame() ?? "";

    expect(output).toContain("Context");
    expect(output).toContain("40%");
    expect(output).toContain("51K / 128K tokens");
    expect(output).not.toContain("Approaching limit");
    expect(output).not.toContain("Near limit");
  });

  it("renders warning gauge with health label", () => {
    const exec = makeExecution({
      currentTokenCount: 96_000,
      contextWindowLimit: 128_000,
      utilizationPercent: 75,
    });

    const { lastFrame } = render(<ContextGauge execution={exec} />);
    const output = lastFrame() ?? "";

    expect(output).toContain("75%");
    expect(output).toContain("96K / 128K tokens");
    expect(output).toContain("Approaching limit");
  });

  it("renders critical gauge with health label", () => {
    const exec = makeExecution({
      currentTokenCount: 118_000,
      contextWindowLimit: 128_000,
      utilizationPercent: 92,
    });

    const { lastFrame } = render(<ContextGauge execution={exec} />);
    const output = lastFrame() ?? "";

    expect(output).toContain("92%");
    expect(output).toContain("118K / 128K tokens");
    expect(output).toContain("Near limit");
  });

  it("shows correct token formatting for large counts", () => {
    const exec = makeExecution({
      currentTokenCount: 1_500_000,
      contextWindowLimit: 2_000_000,
      utilizationPercent: 75,
    });

    const { lastFrame } = render(<ContextGauge execution={exec} />);
    const output = lastFrame() ?? "";

    expect(output).toContain("1.5M / 2.0M tokens");
  });

  it("shows summarization count and latest event details", () => {
    const exec = makeExecution({
      currentTokenCount: 82_000,
      contextWindowLimit: 128_000,
      utilizationPercent: 64,
    });
    addSummarizationEvent(exec, {
      tokensBefore: 120_000,
      tokensAfter: 82_000,
      compressionRatio: 0.32,
      durationMs: 2100,
      model: "claude-haiku-4",
      costUsd: 0.02,
    });

    const { lastFrame } = render(<ContextGauge execution={exec} />);
    const output = lastFrame() ?? "";

    expect(output).toContain("1 compaction");
    expect(output).toContain("120K → 82K tokens (32% reduction)");
    expect(output).toContain("claude-haiku-4");
    expect(output).toContain("2.1s");
    expect(output).toContain("$0.02");
  });

  it("shows plural compaction count for multiple events", () => {
    const exec = makeExecution({
      currentTokenCount: 60_000,
      contextWindowLimit: 128_000,
      utilizationPercent: 47,
    });
    addSummarizationEvent(exec, { tokensBefore: 120_000, tokensAfter: 90_000 });
    addSummarizationEvent(exec, { tokensBefore: 110_000, tokensAfter: 70_000 });
    addSummarizationEvent(exec, { tokensBefore: 100_000, tokensAfter: 60_000 });

    const { lastFrame } = render(<ContextGauge execution={exec} />);
    const output = lastFrame() ?? "";

    expect(output).toContain("3 compactions");
  });
});
