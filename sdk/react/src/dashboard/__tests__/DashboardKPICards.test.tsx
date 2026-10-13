/**
 * Pins the KPI cards: one card each for active, completed and failed agent
 * runs and the organization's tokens, the tokens in compact form and never
 * as money; a pulse placeholder while loading; nothing before a summary
 * exists.
 */
import { afterEach, describe, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DashboardKPICards } from "../DashboardKPICards";
import type { DashboardSummary } from "../types";

function summary(totalTokens: number): DashboardSummary {
  return { activeCount: 2, completedCount: 5, failedCount: 1, totalTokens, orgUsage: null };
}

function valueOf(label: string): string | null | undefined {
  return screen.getByText(label).nextElementSibling?.textContent;
}

describe("DashboardKPICards", () => {
  afterEach(cleanup);

  it("shows each count and the tokens, with no money anywhere", () => {
    const { container } = render(<DashboardKPICards summary={summary(18_400)} isLoading={false} />);
    expect(valueOf("Active")).toBe("2");
    expect(valueOf("Completed")).toBe("5");
    expect(valueOf("Failed")).toBe("1");
    expect(valueOf("Tokens")).toBe("18.4k");
    expect(screen.queryByText(/cost/i)).toBeNull();
    expect(container.textContent).not.toContain("$");
  });

  it.each([
    [0, "0"],
    [847, "847"],
    [1_200_000, "1.2M"],
  ])("formats %s tokens as %s", (tokens, shown) => {
    render(<DashboardKPICards summary={summary(tokens)} isLoading={false} />);
    expect(valueOf("Tokens")).toBe(shown);
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
