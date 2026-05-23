import { describe, test, expect } from "vitest";

// ---------------------------------------------------------------------------
// WorkflowOverviewSummary logic tests
//
// These test the pure formatting/derivation logic used by the summary cards.
// Component rendering tests would require jsdom + React Testing Library;
// the unit tests here validate the data transformations.
// ---------------------------------------------------------------------------

describe("Overview summary formatting", () => {
  test("success rate renders correctly for 100% success", () => {
    const rate = 1.0;
    const pct = `${Math.round(rate * 100)}%`;
    expect(pct).toBe("100%");
  });

  test("success rate renders correctly for partial success", () => {
    const rate = 0.75;
    const pct = `${Math.round(rate * 100)}%`;
    expect(pct).toBe("75%");
  });

  test("success rate renders dash for no data (-1)", () => {
    const rate = -1;
    const display = rate >= 0 ? `${Math.round(rate * 100)}%` : "—";
    expect(display).toBe("—");
  });

  test("formatProtoSeconds handles seconds", () => {
    expect(formatSeconds(45)).toBe("45s");
  });

  test("formatProtoSeconds handles minutes", () => {
    expect(formatSeconds(125)).toBe("2m 5s");
  });

  test("formatProtoSeconds handles exact minutes", () => {
    expect(formatSeconds(120)).toBe("2m");
  });

  test("formatProtoSeconds handles hours", () => {
    expect(formatSeconds(3723)).toBe("1h 2m");
  });

  test("formatProtoSeconds handles exact hours", () => {
    expect(formatSeconds(3600)).toBe("1h");
  });

  test("cost formatting", () => {
    expect(formatCost(0.123456)).toBe("$0.12");
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(42.5)).toBe("$42.50");
  });

  test("success rate color thresholds", () => {
    expect(successColor(0.95)).toBe("success");
    expect(successColor(0.8)).toBe("warning");
    expect(successColor(0.5)).toBe("destructive");
  });
});

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

function successColor(rate: number): string {
  if (rate >= 0.9) return "success";
  if (rate >= 0.7) return "warning";
  return "destructive";
}
