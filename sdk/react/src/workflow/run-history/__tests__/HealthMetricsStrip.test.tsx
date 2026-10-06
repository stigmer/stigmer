/**
 * Pins HealthMetricsStrip: a skeleton while loading, nothing without a
 * summary, and the six metrics read from a RunSummary (total, success
 * rate, average duration, cost, active count, tokens), with the em-dash
 * placeholders when a figure is absent.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { RunSummarySchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/io_pb";
import { HealthMetricsStrip } from "../HealthMetricsStrip";

function metric(region: HTMLElement, label: string): string {
  const labelEl = [...region.querySelectorAll("span")].find((s) => s.textContent === label);
  return labelEl?.nextElementSibling?.textContent ?? "";
}

describe("HealthMetricsStrip", () => {
  afterEach(cleanup);

  it("shows a loading skeleton while the summary loads", () => {
    render(<HealthMetricsStrip summary={null} isLoading />);
    expect(screen.getByLabelText("Loading health metrics")).toBeTruthy();
    expect(screen.queryByRole("region")).toBeNull();
  });

  it("renders nothing without a summary", () => {
    const { container } = render(<HealthMetricsStrip summary={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("reads every metric from the run summary", () => {
    const summary = create(RunSummarySchema, {
      totalCount: 40,
      activeCount: 2,
      successRate: 0.925,
      avgDuration: { seconds: BigInt(135) },
      totalCost: { totalCostUsd: 3.456, totalInputTokens: BigInt(10_000), totalOutputTokens: BigInt(2_500) },
    });
    render(<HealthMetricsStrip summary={summary} />);
    const region = screen.getByRole("region", { name: "Run health metrics" });
    expect(metric(region, "Total")).toBe("40");
    expect(metric(region, "Success")).toBe("93%");
    expect(metric(region, "Avg Duration")).toBe("2m 15s");
    expect(metric(region, "Cost")).toBe("$3.46");
    expect(metric(region, "Active")).toBe("2");
    expect(metric(region, "Tokens")).toBe("12.5K");
  });

  it("shows placeholders when duration, cost and tokens are absent", () => {
    const summary = create(RunSummarySchema, { totalCount: 3, successRate: 0.5 });
    render(<HealthMetricsStrip summary={summary} />);
    const region = screen.getByRole("region", { name: "Run health metrics" });
    expect(metric(region, "Success")).toBe("50%");
    expect(metric(region, "Avg Duration")).toBe("—");
    expect(metric(region, "Cost")).toBe("$0.00");
    expect(metric(region, "Active")).toBe("0");
    expect(metric(region, "Tokens")).toBe("—");
  });
});
