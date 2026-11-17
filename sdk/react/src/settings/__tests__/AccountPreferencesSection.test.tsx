/**
 * The Account preferences settings section: a region named by its heading,
 * the copy saying preferences reach agents on the runs the user starts, and
 * the preferences panel inside it (stubbed here; it has its own tests), and
 * this device's notifications as its last section when the host can ask
 * the system's permission.
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

  it("draws Notifications on this device as a section only when the host can ask permission", () => {
    render(<AccountPreferencesSection />);
    expect(screen.queryByRole("heading", { name: "Notifications on this device" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Tell me when a conversation needs me" })).toBeNull();
    cleanup();

    render(<AccountPreferencesSection requestPermission={vi.fn().mockResolvedValue(true)} />);
    expect(screen.getByRole("heading", { name: "Notifications on this device" })).toBeTruthy();
    expect(screen.getByText("Saves as you switch it.")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Tell me when a conversation needs me" })).toBeTruthy();
  });

  it("passes a host that cannot show notifications through to the switch", () => {
    render(<AccountPreferencesSection requestPermission={vi.fn()} unsupported />);
    const theSwitch = screen.getByRole("switch", { name: "Tell me when a conversation needs me" }) as HTMLButtonElement;
    expect(theSwitch.disabled).toBe(true);
    expect(screen.getByText("This browser can't show notifications.")).toBeTruthy();
  });
});
