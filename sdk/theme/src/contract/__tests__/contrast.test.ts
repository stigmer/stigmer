import { describe, expect, it } from "vitest";
import { runContrastAudit, resultId } from "../audit.js";

/**
 * The permanent contrast gate for the token contract (stigmer/stigmer#187).
 *
 * Every pair declared in `pairs.ts` must meet its threshold in every preset
 * × color mode, resolved through the real cascade. A regression here means
 * shipped chrome text or surfaces became unreadable in someone's theme.
 *
 * EXEMPTIONS is the explicit, reviewed list of accepted misses. Adding to
 * it is a design decision, not a fix — every entry needs a rationale, and
 * the exemption is pinned to a measured floor so an exempted pair can still
 * never silently get *worse*.
 */

interface Exemption {
  /** `resultId()` of the accepted miss. */
  readonly id: string;
  /** Why this miss is acceptable. */
  readonly rationale: string;
  /** The measured value at the time of exemption; regressions below fail. */
  readonly measuredFloor: number;
}

const EXEMPTIONS: readonly Exemption[] = [];

const exemptionById = new Map(EXEMPTIONS.map((e) => [e.id, e]));

describe("token contract contrast audit", () => {
  const { results, leaks } = runContrastAudit();

  it("declared pairs resolve for every preset and mode", () => {
    // 6 presets × 2 modes × (text+supporting+surface pairs); exact count is
    // asserted loosely so adding a pair does not require touching this test.
    expect(results.length).toBeGreaterThan(400);
  });

  it("no preset leaks a light-only token value into dark mode", () => {
    const formatted = leaks.map(
      (leak) => `${leak.preset}: ${leak.tokens.join(", ")}`,
    );
    expect(formatted, "preset tokens defined light-only override the default dark value (see resolve.ts)").toEqual([]);
  });

  const failures = results.filter(
    (r) => r.enforced && !r.passes && !exemptionById.has(resultId(r)),
  );

  it("every non-exempt pair meets its threshold", () => {
    const formatted = failures.map(
      (r) =>
        `${resultId(r)} — ${r.pair.kind} ${r.measured.toFixed(2)} < ${r.threshold} ` +
        `(fg ${r.foregroundValue} on bg ${r.backgroundValue}; used by: ${r.pair.usage})`,
    );
    expect(formatted).toEqual([]);
  });

  it("exempted pairs never regress below their recorded floor", () => {
    const regressions: string[] = [];
    const staleExemptions: string[] = [];
    for (const exemption of EXEMPTIONS) {
      const result = results.find((r) => resultId(r) === exemption.id);
      if (!result) {
        staleExemptions.push(exemption.id);
        continue;
      }
      if (result.passes) {
        // The pair now meets the real threshold — the exemption must be
        // removed so the full gate applies again.
        staleExemptions.push(exemption.id);
      } else if (result.measured < exemption.measuredFloor - 1e-6) {
        regressions.push(
          `${exemption.id}: ${result.measured.toFixed(3)} fell below exempted floor ${exemption.measuredFloor}`,
        );
      }
    }
    expect(regressions).toEqual([]);
    expect(staleExemptions, "exemption no longer needed or references a removed pair — delete it").toEqual([]);
  });
});
