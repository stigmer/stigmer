/**
 * Pins the console's page states. PageNotFound names the missing page and
 * links home. PageFailure titles a failure by its kind (the host may rename
 * a kind), shows the server's line and the failure's reference, retries,
 * offers the host's way out, and ends a whole page's failure with the help
 * line (CON-13), while a failure inside a titled frame (settings) is an h2
 * without it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StigmerError } from "@stigmer/client";
import { PageFailure, PageNotFound } from "../index";

vi.mock("../../help/HelpLink.js", () => ({ HelpLink: () => <p>Stuck? Talk to us</p> }));

afterEach(cleanup);

const HOME = { label: "Go to Dashboard", href: "/" };

describe("PageNotFound", () => {
  it("names the missing page and links home", () => {
    render(<PageNotFound homeHref="/dashboard" />);
    expect(screen.getByRole("heading", { level: 1, name: "Page not found" })).toBeTruthy();
    expect(screen.getByText("The page you're looking for doesn't exist or has been moved.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Dashboard" }).getAttribute("href")).toBe("/dashboard");
  });
});

describe("PageFailure", () => {
  it("names an unrecognised failure, shows its line, reference and help, and retries", async () => {
    const onRetry = vi.fn();
    const error = Object.assign(new Error("The agent list could not be read."), { digest: "abc123" });
    render(<PageFailure error={error} onRetry={onRetry} link={HOME} />);

    expect(screen.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeTruthy();
    expect(screen.getByText("The agent list could not be read.")).toBeTruthy();
    expect(screen.getByText("Reference: abc123")).toBeTruthy();
    expect(screen.getByText("Stuck? Talk to us")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Dashboard" }).getAttribute("href")).toBe("/");

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("titles a failure by its kind", () => {
    render(<PageFailure error={new StigmerError("permission-denied", "You cannot view this agent.", 7)} onRetry={vi.fn()} link={HOME} />);
    expect(screen.getByRole("heading", { level: 1, name: "Access denied" })).toBeTruthy();
    expect(screen.queryByText(/Reference:/)).toBeNull();
  });

  it("draws a section's failure as an h2 without the help line, with the host's titles and way out", () => {
    render(
      <PageFailure
        error={new StigmerError("not-found", "No such section.", 5)}
        onRetry={vi.fn()}
        placement="section"
        titles={{ "not-found": "Section not found" }}
        link={{ label: "Go to Members", href: "/settings/members" }}
      />,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Section not found" })).toBeTruthy();
    expect(screen.queryByText("Stuck? Talk to us")).toBeNull();
    expect(screen.getByRole("link", { name: "Go to Members" }).getAttribute("href")).toBe("/settings/members");
  });
});
