/**
 * The catalog's rate format: two decimals, and more only when a price needs
 * them, so "$0.50/M" reads like "$3.00/M" while "$0.075/M" stays exact.
 */
import { describe, expect, it } from "vitest";
import { formatRate } from "../pricing-format";

describe("formatRate", () => {
  it.each([
    [3_000_000n, "$3.00/M"],
    [15_000_000n, "$15.00/M"],
    [500_000n, "$0.50/M"],
    [600_000n, "$0.60/M"],
    [75_000n, "$0.075/M"],
    [100n, "$0.0001/M"],
    [0n, "$0.00/M"],
  ])("shows %s micro-USD as %s", (micros, shown) => {
    expect(formatRate(micros)).toBe(shown);
  });
});
