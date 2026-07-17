import { describe, expect, it, vi, afterEach } from "vitest";
import {
  MAX_TOOL_ROUNDS,
  MIN_TOOL_ROUNDS,
  SUPER_STEPS_PER_ROUND,
  resolveRecursionLimit,
} from "../tool-rounds.js";

describe("resolveRecursionLimit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null for unset (proto contract: 0 = unlimited)", () => {
    expect(resolveRecursionLimit(undefined)).toBeNull();
    expect(resolveRecursionLimit(0)).toBeNull();
  });

  it("returns null for negative values (treated as unset, never a tiny limit)", () => {
    expect(resolveRecursionLimit(-5)).toBeNull();
  });

  it("converts rounds to super-steps at the contract's x6 factor", () => {
    expect(resolveRecursionLimit(10)).toBe(60);
    expect(resolveRecursionLimit(100)).toBe(600);
    expect(resolveRecursionLimit(MAX_TOOL_ROUNDS)).toBe(MAX_TOOL_ROUNDS * SUPER_STEPS_PER_ROUND);
  });

  it("clamps below-range values up to the minimum with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(resolveRecursionLimit(3)).toBe(MIN_TOOL_ROUNDS * SUPER_STEPS_PER_ROUND);

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("max_tool_rounds=3");
    expect(warn.mock.calls[0][0]).toContain("clamping to 10");
  });

  it("clamps above-range values down to the maximum with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(resolveRecursionLimit(5000)).toBe(MAX_TOOL_ROUNDS * SUPER_STEPS_PER_ROUND);

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toContain("max_tool_rounds=5000");
    expect(warn.mock.calls[0][0]).toContain("clamping to 1000");
  });

  it("does not warn for in-range values", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    resolveRecursionLimit(MIN_TOOL_ROUNDS);
    resolveRecursionLimit(MAX_TOOL_ROUNDS);

    expect(warn).not.toHaveBeenCalled();
  });
});
