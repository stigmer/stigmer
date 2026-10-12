/**
 * Pins the trend chart's rendering: one plot named as an image and
 * described in a sentence, a dot per valued point and a line per run of
 * joined points (a gap splits them), a dot per marker inside the window,
 * a visually hidden table of every point (a gap reads "gap") and marker,
 * the line in the series' chart token, and no native `title` anywhere.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { TrendChart } from "../TrendChart";

afterEach(cleanup);

const POINTS = [
  { date: "2026-10-01", value: 1, count: 4 },
  { date: "2026-10-02", value: 0.75, count: 4 },
  { date: "2026-10-05", value: null, count: 0 },
  { date: "2026-10-08", value: 0.5, count: 2 },
  { date: "2026-10-09", value: 0.25, count: 4 },
];

function renderChart() {
  return render(
    <TrendChart
      label="Run health, daily pass rate"
      points={POINTS}
      markers={[
        { date: "2026-10-08", label: "agent version v2 first seen" },
        { date: "2026-08-01", label: "outside the window" },
      ]}
      from="2026-09-30"
      to="2026-10-10"
      max={1}
      formatValue={(value) => `${Math.round(value * 100)}%`}
      formatCount={(count) => `${count} runs`}
      series={3}
    />,
  );
}

describe("TrendChart", () => {
  it("draws a dot per valued point and a line per run, split at the gap", () => {
    const { container } = renderChart();
    const plot = screen.getByRole("img", { name: "Run health, daily pass rate" });
    expect(container.querySelectorAll("[data-point]")).toHaveLength(4);
    expect(plot.querySelector('[data-point="2026-10-05"]')).toBeNull();
    const lines = container.querySelectorAll("polyline[data-segment]");
    expect(lines).toHaveLength(2);
    expect(lines[0]?.getAttribute("class")).toContain("stg:text-chart-3");
    expect(container.querySelectorAll("[data-marker]")).toHaveLength(1);
    expect(container.querySelector('[data-marker="2026-10-08"]')).not.toBeNull();
    expect(container.querySelector("[title]")).toBeNull();
  });

  it("describes the plot and tables every point and marker", () => {
    renderChart();
    const plot = screen.getByRole("img", { name: "Run health, daily pass rate" });
    const describedBy = plot.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describedBy)?.textContent).toContain(
      "latest 25% on 2026-10-09 (4 runs), 1 gap",
    );
    const table = screen.getByRole("table", { name: "Run health, daily pass rate" });
    const rows = within(table).getAllByRole("row");
    // The header, five points and the one marker inside the window.
    expect(rows).toHaveLength(7);
    expect(within(table).getByRole("row", { name: "2026-10-05 gap 0 runs" })).toBeDefined();
    expect(within(table).getByRole("row", { name: "2026-10-02 75% 4 runs" })).toBeDefined();
    expect(
      within(table).getByRole("row", { name: "2026-10-08 agent version v2 first seen" }),
    ).toBeDefined();
  });

  it("says there is no data for an empty series", () => {
    render(<TrendChart label="Nothing yet" points={[]} />);
    const plot = screen.getByRole("img", { name: "Nothing yet" });
    expect(
      document.getElementById(plot.getAttribute("aria-describedby") ?? "")?.textContent,
    ).toBe("Nothing yet: no data.");
  });

  it("labels the axis with the series' own first and last day when no window is given", () => {
    const { container } = render(
      <TrendChart label="Thumbs, daily" points={[...POINTS].reverse()} />,
    );
    const axis = Array.from(container.querySelectorAll('div[aria-hidden="true"]')).find(
      (div) =>
        div.children.length === 2 &&
        /^\d{4}-\d{2}-\d{2}$/.test(div.children[0]?.textContent ?? ""),
    );
    expect(Array.from(axis?.children ?? []).map((span) => span.textContent)).toEqual([
      "2026-10-01",
      "2026-10-09",
    ]);
  });
});
