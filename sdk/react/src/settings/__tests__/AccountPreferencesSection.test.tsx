/**
 * The Account Preferences settings section: a region named by its heading,
 * the copy saying preferences reach agents on the runs the user starts, and
 * the preferences panel inside it (stubbed here; it has its own tests).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("../../identity-account/AccountPreferencesPanel.js", () => ({
  AccountPreferencesPanel: () => <div data-testid="preferences-panel" />,
}));

import { AccountPreferencesSection } from "../AccountPreferencesSection";

afterEach(cleanup);

describe("AccountPreferencesSection", () => {
  it("names its region by the heading and explains where preferences go", () => {
    render(<AccountPreferencesSection />);

    const region = screen.getByRole("region", { name: "Account Preferences" });
    expect(
      within(region).getByText("Personal standing context shared with agents on runs you start."),
    ).toBeTruthy();
    expect(within(region).getByTestId("preferences-panel")).toBeTruthy();
  });
});
