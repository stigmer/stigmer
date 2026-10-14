/**
 * The usage views' compact count: integers under a thousand, then one
 * decimal with k, M or B, moving to the next unit where rounding would
 * read "1000.0k"; the token and call units are singular for one; shares
 * round to whole percents and are 0 against a zero total.
 */
import { describe, expect, it } from "vitest";
import { formatCalls, formatCompactCount, formatTokens, formatWorkingTime, sharePercent } from "../format";

describe("formatCompactCount", () => {
  it.each([
    [0, "0"],
    [847, "847"],
    [999, "999"],
    [1_000, "1.0k"],
    [18_400, "18.4k"],
    [999_949, "999.9k"],
    [999_950, "1.0M"],
    [1_200_000, "1.2M"],
    [999_950_000, "1.0B"],
    [3_000_000_000, "3.0B"],
  ])("formats %s as %s", (n, shown) => {
    expect(formatCompactCount(n)).toBe(shown);
  });

  it("takes the wire's int64 as a bigint", () => {
    expect(formatCompactCount(18_400n)).toBe("18.4k");
  });
});

describe("formatWorkingTime", () => {
  it("reads as a duration in hours and minutes, never days, and takes the wire's int64", () => {
    expect(formatWorkingTime(0)).toBe("0s");
    expect(formatWorkingTime(42n)).toBe("42s");
    expect(formatWorkingTime(252)).toBe("4m 12s");
    expect(formatWorkingTime(3_599)).toBe("59m 59s");
    expect(formatWorkingTime(3_600)).toBe("1h 0m");
    expect(formatWorkingTime(1_123_500n)).toBe("312h 5m");
    expect(formatWorkingTime(-5)).toBe("0s");
  });
});

describe("units and shares", () => {
  it("names tokens and calls, singular for one", () => {
    expect(formatTokens(1)).toBe("1 token");
    expect(formatTokens(18_400n)).toBe("18.4k tokens");
    expect(formatCalls(1)).toBe("1 call");
    expect(formatCalls(42)).toBe("42 calls");
  });

  it("rounds a share to a whole percent, 0 against nothing", () => {
    expect(sharePercent(1, 3)).toBe(33);
    expect(sharePercent(5n, 0n)).toBe(0);
  });
});
