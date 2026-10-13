/**
 * Usage date ranges are UTC calendar days, matching how the usage reports
 * read date-only bounds: a preset ends on today's UTC date (even when the
 * viewer's local date is still yesterday) and spans exactly its number of
 * days.
 */
import { describe, expect, it } from "vitest";
import { dateRangeFromPreset } from "../date-range";

describe("dateRangeFromPreset", () => {
  it("ends on today's UTC date and spans the preset's days", () => {
    const now = new Date("2026-10-14T01:30:00Z");
    expect(dateRangeFromPreset("7d", now)).toEqual({ from: "2026-10-08", to: "2026-10-14" });
    expect(dateRangeFromPreset("30d", now)).toEqual({ from: "2026-09-15", to: "2026-10-14" });
  });
});
