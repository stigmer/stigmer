import { describe, it, expect } from "vitest";
import { stripUndefined, toTimestamp } from "../../gen/proto-utils";
import { timestampDate } from "@bufbuild/protobuf/wkt";

describe("stripUndefined", () => {
  it("removes keys with undefined values", () => {
    const result = stripUndefined({ a: 1, b: undefined, c: "hello" });
    expect(result).toEqual({ a: 1, c: "hello" });
    expect("b" in result).toBe(false);
  });

  it("preserves null values (falsy but defined)", () => {
    const result = stripUndefined({ a: null });
    expect(result).toEqual({ a: null });
  });

  it("preserves 0 (falsy but defined)", () => {
    const result = stripUndefined({ count: 0 });
    expect(result).toEqual({ count: 0 });
  });

  it("preserves empty string (falsy but defined)", () => {
    const result = stripUndefined({ name: "" });
    expect(result).toEqual({ name: "" });
  });

  it("preserves false (falsy but defined)", () => {
    const result = stripUndefined({ enabled: false });
    expect(result).toEqual({ enabled: false });
  });

  it("returns empty object when all values are undefined", () => {
    const result = stripUndefined({ a: undefined, b: undefined });
    expect(result).toEqual({});
  });

  it("returns all keys when nothing is undefined", () => {
    const input = { x: 1, y: "two", z: true };
    const result = stripUndefined(input);
    expect(result).toEqual(input);
  });

  it("preserves nested objects without deep-stripping", () => {
    const nested = { inner: undefined };
    const result = stripUndefined({ outer: nested });
    expect(result).toEqual({ outer: nested });
    expect((result as Record<string, unknown>).outer).toBe(nested);
  });

  it("returns empty object for empty input", () => {
    const result = stripUndefined({});
    expect(result).toEqual({});
  });
});

describe("toTimestamp", () => {
  it("converts a Date to a Timestamp with correct seconds", () => {
    const date = new Date("2026-05-19T12:00:00.000Z");
    const ts = toTimestamp(date);
    expect(ts.seconds).toBe(BigInt(Math.floor(date.getTime() / 1000)));
    expect(ts.nanos).toBe(0);
  });

  it("converts a Date with milliseconds to a Timestamp with nanos", () => {
    const date = new Date("2026-01-15T08:30:00.456Z");
    const ts = toTimestamp(date);
    const expectedSeconds = BigInt(Math.floor(date.getTime() / 1000));
    expect(ts.seconds).toBe(expectedSeconds);
    expect(ts.nanos).toBe(456_000_000);
  });

  it("converts an ISO string to a Timestamp", () => {
    const isoString = "2026-06-01T00:00:00.000Z";
    const ts = toTimestamp(isoString);
    const expected = new Date(isoString);
    expect(ts.seconds).toBe(BigInt(Math.floor(expected.getTime() / 1000)));
  });

  it("roundtrips correctly through timestampDate", () => {
    const original = new Date("2026-03-10T15:45:30.000Z");
    const ts = toTimestamp(original);
    const roundtripped = timestampDate(ts);
    expect(roundtripped.getTime()).toBe(original.getTime());
  });

  it("handles epoch (Unix timestamp 0)", () => {
    const epoch = new Date(0);
    const ts = toTimestamp(epoch);
    expect(ts.seconds).toBe(BigInt(0));
    expect(ts.nanos).toBe(0);
  });

  it("handles far-future dates", () => {
    const future = new Date("2099-12-31T23:59:59.000Z");
    const ts = toTimestamp(future);
    expect(ts.seconds).toBe(BigInt(Math.floor(future.getTime() / 1000)));
    expect(timestampDate(ts).getTime()).toBe(future.getTime());
  });
});
