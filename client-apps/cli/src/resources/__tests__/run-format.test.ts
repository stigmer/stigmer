// Unit tests for the run output formatters: duration math between two
// timestamps, ellipsis truncation, and the compact token count the usage
// reports and the run epilogue print.

import { describe, expect, it } from "vitest";
import { calculateDuration, formatTokenCount, truncateWithEllipsis } from "../run-format.js";

describe("calculateDuration", () => {
  it("returns '-' when a bound is missing or unparseable", () => {
    expect(calculateDuration("", "2026-01-01T00:00:01Z")).toBe("-");
    expect(calculateDuration("2026-01-01T00:00:00Z", "")).toBe("-");
    expect(calculateDuration("not-a-date", "2026-01-01T00:00:01Z")).toBe("-");
  });

  it("formats sub-minute durations in seconds", () => {
    expect(calculateDuration("2026-01-01T00:00:00Z", "2026-01-01T00:00:42Z")).toBe("42s");
  });

  it("formats sub-hour durations as minutes and seconds", () => {
    expect(calculateDuration("2026-01-01T00:00:00Z", "2026-01-01T00:05:09Z")).toBe("5m 9s");
  });

  it("formats hour-plus durations as hours and minutes", () => {
    expect(calculateDuration("2026-01-01T00:00:00Z", "2026-01-01T02:30:00Z")).toBe("2h 30m");
  });
});

describe("truncateWithEllipsis", () => {
  it("leaves short strings untouched", () => {
    expect(truncateWithEllipsis("short", 10)).toBe("short");
  });

  it("truncates and appends an ellipsis", () => {
    expect(truncateWithEllipsis("abcdefghij", 8)).toBe("abcde...");
  });
});

describe("formatTokenCount", () => {
  it("prints counts under a thousand whole", () => {
    expect(formatTokenCount(0n)).toBe("0");
    expect(formatTokenCount(999n)).toBe("999");
  });

  it("prints thousands with one decimal and a k", () => {
    expect(formatTokenCount(1000n)).toBe("1.0k");
    expect(formatTokenCount(18_400n)).toBe("18.4k");
    expect(formatTokenCount(999_949n)).toBe("999.9k");
  });

  it("moves to M where k would round up to a thousand", () => {
    expect(formatTokenCount(999_950n)).toBe("1.0M");
    expect(formatTokenCount(1_234_567n)).toBe("1.2M");
  });
});
