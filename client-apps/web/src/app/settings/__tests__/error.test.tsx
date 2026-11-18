// ---------------------------------------------------------------------------
// The Settings error boundary page: a section that throws keeps the person
// inside Settings
//
// The page says the failure from its kind in the kit's own sentence, keeps
// the error's own line, says the settings are as the person left them,
// keeps the reference digest in Copy details rather than on the screen, and
// offers two ways on that stay in Settings: a "Try again" that calls the
// boundary's reset, and "Back to Settings" to the settings landing.
// ---------------------------------------------------------------------------

import { StigmerError } from "@stigmer/client";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsError from "../error";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  // The page logs the error it caught; keep the run's output quiet.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("settings error page", () => {
  it("says an unrecognised failure, keeps its digest off the screen, and resets on Try again", () => {
    const reset = vi.fn();
    const error = Object.assign(new Error("The members list could not be read."), { digest: "abc123" });
    render(<SettingsError error={error} reset={reset} />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Something went wrong.");
    expect(alert.textContent).toContain("The members list could not be read.");
    expect(alert.textContent).toContain("Your settings are as you left them; only this page didn't load.");
    expect(alert.textContent).not.toContain("abc123");

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("offers the way back to the settings landing, never one section", () => {
    render(<SettingsError error={new StigmerError("not-found", "No such section.", 5)} reset={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Back to Settings" }).getAttribute("href")).toBe("/settings");
    expect(screen.queryByRole("link", { name: "Go to Members" })).toBeNull();
  });
});
