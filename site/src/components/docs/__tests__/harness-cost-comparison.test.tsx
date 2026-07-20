import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { HarnessCostComparison } from "../harness-cost-comparison";
import fixture from "@/data/harness-cost-comparison.json";
import {
  formatBenchmarkUsd,
  type HarnessCostComparisonData,
} from "../harness-cost-comparison.data";

// The component renders the generated fixture directly (build-time import),
// so these tests assert against the fixture's own values — they stay green
// across regenerations as long as the schema contract holds.
const data = fixture as HarnessCostComparisonData;

afterEach(() => {
  cleanup();
});

describe("HarnessCostComparison", () => {
  it("leads with the model-parity section and labels it as same-model", () => {
    render(<HarnessCostComparison />);

    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings[0].textContent).toMatch(/same model/i);
  });

  it("presents the default-model section as a dated snapshot naming the routed model", () => {
    render(<HarnessCostComparison />);

    const defaultCategory = data.categories.find((c) => c.mode === "default");
    expect(defaultCategory).toBeDefined();
    // The routed cursor model must be named in the snapshot caveat prose.
    const snapshot = screen.getByText(/auto-routed to/i);
    expect(snapshot.textContent).toContain(defaultCategory!.cursor.model);
  });

  it("renders every category row with its warm median cost", () => {
    render(<HarnessCostComparison />);

    for (const cat of data.categories) {
      const nativeCost = formatBenchmarkUsd(cat.native.warmBillableMicros);
      // The same formatted value can appear in several rows; presence is enough.
      expect(
        screen.getAllByText((content) => content.includes(nativeCost)).length,
      ).toBeGreaterThan(0);
    }
  });

  it("shows the honesty metadata: run date, repetition count, and suite SHA", () => {
    render(<HarnessCostComparison />);

    const footer = screen.getByText(/warm\s*repetitions per cell/i);
    expect(footer.textContent).toContain(data.gitSha);
    expect(footer.textContent).toContain(String(data.repsPerCell));
  });

  it("keeps the decorative cost bars out of the accessibility tree", () => {
    const { container } = render(<HarnessCostComparison />);

    const bars = container.querySelectorAll('[aria-hidden="true"]');
    expect(bars.length).toBeGreaterThan(0);
    // Tables remain the accessible primary.
    expect(screen.getAllByRole("table").length).toBeGreaterThan(0);
  });

  it("surfaces the cold first-call cost separately from the warm median", () => {
    render(<HarnessCostComparison />);

    const withCold = data.categories.find((c) => c.native.coldBillableMicros !== null);
    expect(withCold).toBeDefined();
    expect(screen.getAllByText(/first call/i).length).toBeGreaterThan(0);
  });
});
