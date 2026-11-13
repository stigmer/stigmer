// ---------------------------------------------------------------------------
// The root error boundary page: what a person sees when a route throws
//
// The page names the failure by its category (an access failure reads
// "Access denied", anything unrecognised "Something went wrong"), shows the
// error's own message and its reference digest, and offers two ways out: a
// "Try again" that calls the boundary's reset and a "Go to Dashboard" link
// to the console's home.
// ---------------------------------------------------------------------------

import { StigmerError } from "@stigmer/client";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RootError from "../error";

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

describe("root error page", () => {
  it("names an unrecognised failure, shows its message and digest, and resets on Try again", () => {
    const reset = vi.fn();
    const error = Object.assign(new Error("The agent list could not be read."), { digest: "abc123" });

    render(<RootError error={error} reset={reset} />);

    expect(screen.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeTruthy();
    expect(screen.getByText("The agent list could not be read.")).toBeTruthy();
    expect(screen.getByText("Reference: abc123")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("titles a permission failure as access denied and links home to the dashboard", () => {
    render(
      <RootError error={new StigmerError("permission-denied", "You cannot view this agent.", 7)} reset={vi.fn()} />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Access denied" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Dashboard" }).getAttribute("href")).toBe("/");
    expect(screen.queryByText(/Reference:/)).toBeNull();
  });
});
