import { describe, expect, it } from "vitest";
import { UsageError } from "../../errors/index.js";
import { parseExpiration } from "./duration.js";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const YEAR = 365 * DAY;

describe("parseExpiration", () => {
  it.each([
    ["30m", 30 * MINUTE],
    ["6h", 6 * HOUR],
    ["30d", 30 * DAY],
    ["1y", YEAR],
  ])("parses %s", (input, expected) => {
    expect(parseExpiration(input)).toBe(expected);
  });

  it.each(["", "d", "30x", "abc", "0d", "-5d", "1.5d"])("rejects %s as a usage error", (input) => {
    expect(() => parseExpiration(input)).toThrow(UsageError);
  });
});
