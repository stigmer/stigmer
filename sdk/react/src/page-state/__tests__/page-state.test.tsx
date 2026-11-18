/**
 * Pins the console's page states, drawn inside the console's frame.
 * PageNotFound says there's nothing at the address and offers the
 * dashboard. PageFailure says the failure from its kind (the kit's
 * sentence: the server didn't answer, no access, signed out), says what
 * wasn't lost, offers the act that can help (Try again, or Sign in again),
 * keeps the failure's reference in Copy details rather than on the screen,
 * ends with the help line (CON-13), and offers the host's quiet way out.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StigmerError } from "@stigmer/client";
import { PageFailure, PageNotFound } from "../index";

vi.mock("../../help/HelpLink.js", () => ({
  HelpLink: () => <p>Stuck? Talk to us</p>,
  FailureHelpLine: () => <p>Stuck? Talk to us</p>,
}));

afterEach(cleanup);

describe("PageNotFound", () => {
  it("says there's nothing at the address and offers the dashboard", () => {
    render(<PageNotFound homeHref="/dashboard" />);
    expect(screen.getByText("There's nothing at this address")).toBeTruthy();
    expect(screen.getByText("It may have been mistyped, or the page has moved.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to the dashboard" }).getAttribute("href")).toBe("/dashboard");
  });
});

describe("PageFailure", () => {
  it("says an unrecognised failure, keeps its reference off the screen, ends with help, and retries", async () => {
    const onRetry = vi.fn();
    const error = Object.assign(new Error("The agent list could not be read."), { digest: "abc123" });
    render(<PageFailure error={error} onRetry={onRetry} />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Something went wrong.");
    expect(alert.textContent).toContain("The agent list could not be read.");
    expect(alert.textContent).toContain("Nothing was lost; only this page didn't load.");
    expect(alert.textContent).not.toContain("abc123");
    expect(screen.getByRole("button", { name: "Copy details" })).toBeTruthy();
    expect(screen.getByText("Stuck? Talk to us")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("says a failure from its kind, with no Try again where trying can't help, and the host's way out", () => {
    render(
      <PageFailure
        error={new StigmerError("permission-denied", "You cannot view this agent.", 7)}
        onRetry={vi.fn()}
        link={{ label: "Go to the dashboard", href: "/" }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("You don't have access to this.");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByRole("link", { name: "Go to the dashboard" }).getAttribute("href")).toBe("/");
  });

  it("offers Sign in again for a signed-out failure", async () => {
    const signIn = vi.fn();
    render(<PageFailure error={new StigmerError("unauthenticated", "Your session ended.", 16)} onRetry={vi.fn()} signIn={signIn} />);
    expect(screen.getByRole("alert").textContent).toContain("You're signed out.");
    await userEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("draws a section's failure inside its layout's frame, with the host's comfort and way back", () => {
    render(
      <PageFailure
        error={new StigmerError("internal", "internal error", 13)}
        onRetry={vi.fn()}
        placement="section"
        comfort="Your settings are as you left them; only this page didn't load."
        link={{ label: "Back to Settings", href: "/settings" }}
      />,
    );
    expect(screen.getByRole("alert").textContent).toContain("Your settings are as you left them; only this page didn't load.");
    expect(screen.getByRole("link", { name: "Back to Settings" }).getAttribute("href")).toBe("/settings");
  });
});
