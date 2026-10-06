/**
 * ContextGauge renders a run's context window as a meter: nothing when the
 * run carries no context info, a percentage-only bar in compact mode, and in
 * full mode the token counts, the health label from the utilization
 * thresholds, and the latest summarization's reduction.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  AgentRunSchema,
  AgentRunStatusSchema,
  type AgentRun,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import {
  ContextInfoSchema,
  SummarizationEventSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/context_pb";
import { ContextGauge } from "../ContextGauge";

afterEach(cleanup);

function runWithContext(currentTokenCount: number, utilizationPercent: number, summarized = false): AgentRun {
  const contextInfo = create(ContextInfoSchema, {
    currentTokenCount,
    contextWindowLimit: 200_000,
    summarizationTriggerThreshold: 180_000,
    summarizationTargetTokens: 160_000,
    summarizationEnabled: true,
    utilizationPercent,
  });
  if (summarized) {
    contextInfo.summarizationEvents.push(
      create(SummarizationEventSchema, { tokensBefore: 180_000, tokensAfter: 80_000, compressionRatio: 0.56 }),
    );
  }
  return create(AgentRunSchema, { status: create(AgentRunStatusSchema, { contextInfo }) });
}

describe("ContextGauge", () => {
  it("renders nothing for a run without context info", () => {
    const { container } = render(<ContextGauge run={create(AgentRunSchema)} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for no run", () => {
    const { container } = render(<ContextGauge run={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows token counts and a healthy label in full mode", () => {
    render(<ContextGauge run={runWithContext(10_000, 5)} />);
    const meter = screen.getByRole("meter", { name: "Context window utilization" });
    expect(meter.getAttribute("aria-valuetext")).toBe("10K of 200K tokens used, 5%");
    expect(screen.getByText("Healthy")).toBeTruthy();
    expect(meter.textContent).toContain("10K / 200K tokens");
  });

  it("labels a run near its limit and summarizes the latest compaction", () => {
    render(<ContextGauge run={runWithContext(184_000, 92, true)} />);
    expect(screen.getByText("Near limit")).toBeTruthy();
    expect(screen.getByText(/1 summarization$/)).toBeTruthy();
    expect(screen.getByText(/56% reduction/)).toBeTruthy();
  });

  it("renders only the percentage in compact mode", () => {
    render(<ContextGauge run={runWithContext(150_000, 75)} compact />);
    const meter = screen.getByRole("meter");
    expect(meter.getAttribute("aria-valuetext")).toBe("75% context used");
    expect(meter.textContent).toBe("75%");
    expect(screen.queryByText("Approaching limit")).toBeNull();
  });
});
