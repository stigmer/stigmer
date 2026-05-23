import { describe, it, expect } from "vitest";
import {
  formatDuration,
  formatDurationSec,
  formatMicroUsd,
  formatTokenCount,
  formatBytes,
  formatTimestamp,
  formatMetaChips,
} from "../format-utils";

describe("formatDuration", () => {
  it("formats sub-second durations in milliseconds", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(42)).toBe("42ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  it("formats seconds with one decimal place", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(59_999)).toBe("60.0s");
  });

  it("formats minutes with remaining seconds", () => {
    expect(formatDuration(60_000)).toBe("1m");
    expect(formatDuration(90_000)).toBe("1m 30s");
    expect(formatDuration(3_599_000)).toBe("59m 59s");
  });

  it("formats hours with remaining minutes", () => {
    expect(formatDuration(3_600_000)).toBe("1h");
    expect(formatDuration(5_400_000)).toBe("1h 30m");
    expect(formatDuration(7_260_000)).toBe("2h 1m");
  });
});

describe("formatMicroUsd", () => {
  it("returns $0.0000 for zero", () => {
    expect(formatMicroUsd(BigInt(0))).toBe("$0.0000");
  });

  it("uses 4 decimal places for sub-cent amounts", () => {
    expect(formatMicroUsd(BigInt(100))).toBe("$0.0001");
    expect(formatMicroUsd(BigInt(5000))).toBe("$0.0050");
    expect(formatMicroUsd(BigInt(9999))).toBe("$0.0100");
  });

  it("uses 2 decimal places for cent-or-more amounts", () => {
    expect(formatMicroUsd(BigInt(10_000))).toBe("$0.01");
    expect(formatMicroUsd(BigInt(190_000))).toBe("$0.19");
    expect(formatMicroUsd(BigInt(1_000_000))).toBe("$1.00");
    expect(formatMicroUsd(BigInt(4_500_000))).toBe("$4.50");
  });

  it("handles large amounts", () => {
    expect(formatMicroUsd(BigInt(123_456_789))).toBe("$123.46");
  });
});

describe("formatTokenCount", () => {
  it("formats small numbers with locale separators", () => {
    expect(formatTokenCount(BigInt(0))).toBe("0");
    expect(formatTokenCount(BigInt(999))).toBe("999");
  });

  it("abbreviates thousands as K", () => {
    expect(formatTokenCount(BigInt(1_000))).toBe("1.0K");
    expect(formatTokenCount(BigInt(12_400))).toBe("12.4K");
    expect(formatTokenCount(BigInt(999_999))).toBe("1000.0K");
  });

  it("abbreviates millions as M", () => {
    expect(formatTokenCount(BigInt(1_000_000))).toBe("1.0M");
    expect(formatTokenCount(BigInt(2_500_000))).toBe("2.5M");
  });
});

describe("formatBytes", () => {
  it("formats bytes", () => {
    expect(formatBytes(BigInt(0))).toBe("0 B");
    expect(formatBytes(BigInt(512))).toBe("512 B");
    expect(formatBytes(BigInt(1023))).toBe("1023 B");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(BigInt(1024))).toBe("1.0 KB");
    expect(formatBytes(BigInt(4_300))).toBe("4.2 KB");
  });

  it("formats megabytes", () => {
    expect(formatBytes(BigInt(1_048_576))).toBe("1.0 MB");
    expect(formatBytes(BigInt(1_572_864))).toBe("1.5 MB");
  });
});

describe("formatTimestamp", () => {
  it("returns empty string for empty input", () => {
    expect(formatTimestamp("")).toBe("");
  });

  it("formats ISO timestamps to HH:MM:SS", () => {
    const result = formatTimestamp("2026-05-23T14:30:15.123Z");
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it("returns raw string on invalid date", () => {
    expect(formatTimestamp("not-a-date")).toBe("not-a-date");
  });
});

describe("formatMetaChips", () => {
  it("returns null when all values are empty", () => {
    expect(formatMetaChips({})).toBeNull();
    expect(formatMetaChips({ durationMs: 0, costMicros: BigInt(0), tokens: BigInt(0) })).toBeNull();
  });

  it("formats duration only", () => {
    expect(formatMetaChips({ durationMs: 1500 })).toBe("1.5s");
  });

  it("formats all three metrics joined by ·", () => {
    const result = formatMetaChips({
      durationMs: 1500,
      costMicros: BigInt(190_000),
      tokens: BigInt(12_400),
    });
    expect(result).toBe("1.5s · $0.19 · 12,400 tok");
  });

  it("omits zero values", () => {
    const result = formatMetaChips({
      durationMs: 1500,
      costMicros: BigInt(0),
      tokens: BigInt(5000),
    });
    expect(result).toBe("1.5s · 5,000 tok");
  });
});

describe("formatDurationSec", () => {
  it("formats sub-minute durations in seconds", () => {
    expect(formatDurationSec(0)).toBe("0s");
    expect(formatDurationSec(42)).toBe("42s");
    expect(formatDurationSec(59.4)).toBe("59s");
  });

  it("formats minutes with remaining seconds", () => {
    expect(formatDurationSec(60)).toBe("1m");
    expect(formatDurationSec(90)).toBe("1m 30s");
    expect(formatDurationSec(3599)).toBe("59m 59s");
  });

  it("formats hours with remaining minutes", () => {
    expect(formatDurationSec(3600)).toBe("1h");
    expect(formatDurationSec(5400)).toBe("1h 30m");
    expect(formatDurationSec(7260)).toBe("2h 1m");
  });
});
