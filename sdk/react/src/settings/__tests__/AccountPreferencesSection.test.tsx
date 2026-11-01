/**
 * The Account preferences settings section: a region named by its heading,
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

    const region = screen.getByRole("region", { name: "Account preferences" });
    expect(
      within(region).getByText("What agents know about you on every run you start, and the models you start with."),
    ).toBeTruthy();
    expect(within(region).getByTestId("preferences-panel")).toBeTruthy();
  });
});
