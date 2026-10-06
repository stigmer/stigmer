/**
 * Pins the KPI cards: one card each for active, completed and failed agent
 * runs and the total cost, the cost formatted to the precision its size
 * needs; a pulse placeholder while loading; nothing before a summary exists.
 */
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DashboardKPICards } from "../DashboardKPICards";
import type { DashboardSummary } from "../types";

function summary(totalCostUsd: number): DashboardSummary {
  return { activeCount: 2, completedCount: 5, failedCount: 1, totalCostUsd, orgUsage: null };
}

function valueOf(label: string): string | null | undefined {
  return screen.getByText(label).nextElementSibling?.textContent;
}

describe("DashboardKPICards", () => {
  afterEach(cleanup);

  it("shows each count and the cost", () => {
    render(<DashboardKPICards summary={summary(12.5)} isLoading={false} />);
    expect(valueOf("Active")).toBe("2");
    expect(valueOf("Completed")).toBe("5");
    expect(valueOf("Failed")).toBe("1");
    expect(valueOf("Total Cost")).toBe("$12.50");
  });

  it.each([
    [0.05, "$0.050"],
    [0.004, "<$0.01"],
    [0, "$0.00"],
  ])("formats a cost of %s as %s", (usd, shown) => {
    render(<DashboardKPICards summary={summary(usd)} isLoading={false} />);
    expect(valueOf("Total Cost")).toBe(shown);
  });

  it("shows a busy placeholder while loading", () => {
    const { container } = render(<DashboardKPICards summary={null} isLoading />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText("Active")).toBeNull();
  });

  it("renders nothing before a summary exists", () => {
    const { container } = render(<DashboardKPICards summary={null} isLoading={false} />);
    expect(container.firstChild).toBeNull();
  });
});
