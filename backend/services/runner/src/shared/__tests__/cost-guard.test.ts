/**
 * Unit tests for the Cursor harness's max_cost_usd guard (cost-guard.ts).
 *
 * The guard is the cursor-side analog of the native cost-cap middleware
 * (middleware/cost-cap.ts): same proto semantics (0/unset = no cap), same
 * inclusive boundary (`>=`), same estimation basis. These tests pin those
 * semantics so the two harnesses cannot silently diverge.
 */

import { describe, it, expect } from "vitest";
import {
  costCapExceeded,
  formatCostLimitError,
  COST_LIMIT_ERROR_PREFIX,
  COST_LIMIT_USER_COPY,
} from "../cost-guard.js";

describe("costCapExceeded", () => {
  it("never fires when no cap is configured (0 = unset per the proto contract)", () => {
    expect(costCapExceeded(0, 999)).toBe(false);
  });

  it("never fires for a negative cap", () => {
    expect(costCapExceeded(-1, 999)).toBe(false);
  });

  it("does not fire below the cap", () => {
    expect(costCapExceeded(0.5, 0.4999)).toBe(false);
  });

  it("fires exactly at the cap (inclusive boundary, matching the native middleware)", () => {
    expect(costCapExceeded(0.5, 0.5)).toBe(true);
  });

  it("fires above the cap", () => {
    expect(costCapExceeded(0.5, 0.51)).toBe(true);
  });

  it("does not fire when nothing has been spent", () => {
    expect(costCapExceeded(0.5, 0)).toBe(false);
  });
});

describe("cost-limit terminal copy", () => {
  it("pins the error prefix consumers match on (no structured termination reason exists)", () => {
    // Mirrors the TOOL_CALL_LIMIT_ERROR_PREFIX guard in
    // streaming-terminal.test.ts: a reword silently downgrades any consumer
    // matching this prefix to generic error copy.
    expect(COST_LIMIT_ERROR_PREFIX).toBe("Agent reached the cost limit");
  });

  it("formats the error with the prefix, both amounts, and a continuation hint", () => {
    const err = formatCostLimitError(0.5, 0.5123);
    expect(err.startsWith(COST_LIMIT_ERROR_PREFIX)).toBe(true);
    expect(err).toContain("$0.5123");
    expect(err).toContain("$0.50");
    expect(err).toContain("Send another message to continue");
  });

  it("user copy is honest about the limit and that work is saved", () => {
    expect(COST_LIMIT_USER_COPY).toContain("cost limit");
    expect(COST_LIMIT_USER_COPY).toContain("saved");
  });
});
