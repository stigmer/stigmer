// The low-balance banner: silent at or above the threshold, a warning with
// the formatted balance below it, and the exhausted copy (which names agent
// runs as what credits keep going) at zero or below.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LowBalanceBanner } from "../LowBalanceBanner";

afterEach(cleanup);

describe("LowBalanceBanner", () => {
  it("renders nothing when the balance is at or above the threshold", () => {
    const { container } = render(
      <LowBalanceBanner availableMicros={5_000_000n} thresholdMicros={5_000_000n} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("warns with the formatted balance when it is below the threshold", () => {
    render(<LowBalanceBanner availableMicros={1_230_000n} thresholdMicros={5_000_000n} />);
    expect(screen.getByRole("alert").textContent).toContain("Low credit balance");
    expect(screen.getByText(/Your balance \(\$1\.23\) is below the warning threshold/)).toBeTruthy();
  });

  it("shows the exhausted copy when the balance is zero", () => {
    render(<LowBalanceBanner availableMicros={0n} thresholdMicros={5_000_000n} />);
    expect(screen.getByText("Credit balance exhausted")).toBeTruthy();
    expect(
      screen.getByText(
        "Your credit balance is zero. Credits pay for agent usage on every plan; purchase credits to keep agent runs going.",
      ),
    ).toBeTruthy();
  });
});
