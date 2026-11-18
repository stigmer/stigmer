// ---------------------------------------------------------------------------
// The root error boundary page: what a person sees when a route throws
//
// The page says the failure from its kind in the kit's own sentence (no
// access reads "You don't have access to this.", anything unrecognised
// "Something went wrong."), keeps the error's own line, says nothing was
// lost, keeps the reference digest in Copy details rather than on the
// screen, and offers the act that can help: "Try again", which calls the
// boundary's reset, where trying again can help.
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
  it("says an unrecognised failure, keeps its digest off the screen, and resets on Try again", () => {
    const reset = vi.fn();
    const error = Object.assign(new Error("The agent list could not be read."), { digest: "abc123" });
    render(<RootError error={error} reset={reset} />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Something went wrong.");
    expect(alert.textContent).toContain("The agent list could not be read.");
    expect(alert.textContent).toContain("Nothing was lost; only this page didn't load.");
    expect(alert.textContent).not.toContain("abc123");

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("says a permission failure in the kit's words, with no Try again where it can't help", () => {
    render(
      <RootError error={new StigmerError("permission-denied", "You cannot view this agent.", 7)} reset={vi.fn()} />,
    );
    expect(screen.getByRole("alert").textContent).toContain("You don't have access to this.");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
