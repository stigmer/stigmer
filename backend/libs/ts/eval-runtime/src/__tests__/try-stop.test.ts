/**
 * Pins the try-stop wording (try-stop.ts): each stop round-trips through
 * the run error, the cost-limit sentence keeps its stable prefix, and an
 * error that is no try stop parses as none.
 */

import { describe, expect, it } from "vitest";
import { COST_LIMIT_ERROR_PREFIX, formatTryStop, parseTryStop, type TryStop } from "../try-stop.js";

describe("formatTryStop and parseTryStop", () => {
  it.each<TryStop>([
    { kind: "cost-limit", estimatedCostUsd: 0.1234, maxCostUsd: 0.5 },
    { kind: "scaffold-failed", detail: "exit 2: git: not found" },
    { kind: "mock-aborted", server: "tracker", tool: "create_issue", reason: "input.priority must be one of low, high" },
    { kind: "mock-aborted", server: 'odd "name"', tool: "a.b", reason: "the agent mocks' call budget of 40 calls ran out" },
  ])("round-trips %o", (stop) => {
    expect(parseTryStop(formatTryStop(stop))).toEqual(stop);
  });

  it("writes the cost-limit sentence runs have always carried", () => {
    expect(formatTryStop({ kind: "cost-limit", estimatedCostUsd: 1.5, maxCostUsd: 2 })).toBe(
      "Agent reached the cost limit for this message (~$1.5000 of the $2.00 budget). Send another message to continue.",
    );
    expect(parseTryStop(`${COST_LIMIT_ERROR_PREFIX} somehow`)).toEqual({
      kind: "cost-limit",
      estimatedCostUsd: 0,
      maxCostUsd: 0,
    });
  });

  it("keeps a detail on one line", () => {
    expect(formatTryStop({ kind: "scaffold-failed", detail: "exit 1\n  line two\n" })).toBe(
      "The eval case's scaffold failed: exit 1 line two",
    );
  });

  it("reads any other error as no try stop", () => {
    expect(parseTryStop("timed out after 300s")).toBeUndefined();
    expect(parseTryStop("A mock stopped the run: garbled")).toBeUndefined();
  });
});
