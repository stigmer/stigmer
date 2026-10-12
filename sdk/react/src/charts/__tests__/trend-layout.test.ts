/**
 * Pins the trend chart's geometry: x is calendar time inside the plot's
 * inset (a lone day in the middle), y is the value against the scale's top
 * with 0 at the bottom, a `null` value breaks the line into separate runs
 * while a missing day does not, points are placed in date order whatever
 * order they arrive in, and the sentence a screen reader hears names the
 * days, the latest value with its count, the gaps and the marked days.
 */
import { describe, expect, it } from "vitest";
import {
  PLOT_INSET,
  dayNumber,
  describeTrend,
  domainOf,
  scaleMaxOf,
  segmentsOf,
  xOf,
  yOf,
} from "../trend-layout";

describe("trend geometry", () => {
  it("places days by calendar distance inside the inset", () => {
    const domain = domainOf([], "2026-10-01", "2026-10-11");
    expect(xOf("2026-10-01", domain)).toBe(PLOT_INSET);
    expect(xOf("2026-10-11", domain)).toBe(100 - PLOT_INSET);
    expect(xOf("2026-10-06", domain)).toBe(50);
    expect(xOf("2026-10-06", { first: domain.first, last: domain.first })).toBe(50);
  });

  it("places values against the scale's top, 0 at the bottom", () => {
    expect(yOf(0, 1)).toBe(100 - PLOT_INSET);
    expect(yOf(1, 1)).toBe(PLOT_INSET);
    expect(yOf(2, 1)).toBe(PLOT_INSET);
    expect(scaleMaxOf([{ date: "2026-10-01", value: 7, count: 7 }])).toBe(7);
    expect(scaleMaxOf([{ date: "2026-10-01", value: 0.5, count: 2 }], 1)).toBe(1);
    expect(scaleMaxOf([{ date: "2026-10-01", value: null, count: 0 }])).toBe(1);
  });

  it("breaks the line at a gap, not at a missing day, in date order", () => {
    const points = [
      { date: "2026-10-09", value: 0.5, count: 2 },
      { date: "2026-10-01", value: 1, count: 4 },
      { date: "2026-10-02", value: 0.75, count: 4 },
      { date: "2026-10-05", value: null, count: 0 },
    ];
    const domain = domainOf(points);
    const segments = segmentsOf(points, domain, 1);
    expect(segments.map((segment) => segment.map((placed) => placed.point.date))).toEqual([
      ["2026-10-01", "2026-10-02"],
      ["2026-10-09"],
    ]);
  });

  it("describes the series in one sentence", () => {
    const sentence = describeTrend(
      "Run health",
      [
        { date: "2026-10-01", value: 1, count: 4 },
        { date: "2026-10-03", value: null, count: 0 },
        { date: "2026-10-05", value: 0.5, count: 2 },
      ],
      [{ date: "2026-10-04", label: "agent version v2 first seen" }],
      (value) => `${Math.round(value * 100)}%`,
      (count) => `${count} runs`,
    );
    expect(sentence).toBe(
      "Run health: 2 days from 2026-10-01 to 2026-10-05, latest 50% on 2026-10-05 (2 runs), 1 gap, marked: 2026-10-04 agent version v2 first seen.",
    );
    expect(describeTrend("Empty", [], [], String, String)).toBe("Empty: no data.");
  });

  it("reads a YYYY-MM-DD date as days since the epoch, and anything else as NaN", () => {
    expect(dayNumber("1970-01-02")).toBe(1);
    expect(Number.isNaN(dayNumber("not a date"))).toBe(true);
  });
});
