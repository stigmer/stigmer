// ---------------------------------------------------------------------------
// The Settings error boundary page: a section that throws keeps the person
// inside Settings
//
// The page names the failure by its category (a missing section reads
// "Section not found", anything unrecognised "Something went wrong"), shows
// the error's own message and its reference digest, and offers two ways
// out that stay in Settings: a "Try again" that calls the boundary's reset
// and a "Go to Members" link to the members section.
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
  it("names an unrecognised failure, shows its message and digest, and resets on Try again", () => {
    const reset = vi.fn();
    const error = Object.assign(new Error("The members could not be read."), { digest: "def456" });

    render(<SettingsError error={error} reset={reset} />);

    expect(screen.getByRole("heading", { level: 2, name: "Something went wrong" })).toBeTruthy();
    expect(screen.getByText("The members could not be read.")).toBeTruthy();
    expect(screen.getByText("Reference: def456")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("titles a missing section as not found and links to the members section", () => {
    render(<SettingsError error={new StigmerError("not-found", "No such section.", 5)} reset={vi.fn()} />);

    expect(screen.getByRole("heading", { level: 2, name: "Section not found" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Members" }).getAttribute("href")).toBe("/settings/members");
    expect(screen.queryByText(/Reference:/)).toBeNull();
  });
});
