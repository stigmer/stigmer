/**
 * Pins the standalone frame every screen outside the console's frame stands
 * on: the host's mark, the title as the page's h1, the line under it, the
 * body, the acts, the corner, a wait said as a live status, and the help
 * line where the screen asks for it. It renders with no `StigmerProvider`
 * (a configuration or a console that failed before its client existed),
 * where the help line and a failure note's help line draw nothing.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { StandaloneScreen } from "../StandaloneScreen";
import { ErrorMessage } from "../../error/ErrorMessage";

afterEach(cleanup);

describe("StandaloneScreen", () => {
  it("draws the mark, the title as the h1, the line, the body, the acts and the corner", () => {
    render(
      <StandaloneScreen
        mark={<span>the mark</span>}
        title="Sign in to Stigmer"
        lead="You'll continue on your sign-in page."
        acts={<button type="button">Sign in</button>}
        corner={<button type="button">Account</button>}
      >
        <p>the body</p>
      </StandaloneScreen>,
    );
    expect(screen.getByText("the mark")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Sign in to Stigmer" })).toBeTruthy();
    expect(screen.getByText("You'll continue on your sign-in page.")).toBeTruthy();
    expect(screen.getByText("the body")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Account" })).toBeTruthy();
  });

  it("says what it waits for as a live status", () => {
    render(<StandaloneScreen wait="Checking your account…" />);
    expect(screen.getByRole("status").textContent).toBe("Checking your account…");
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("renders a failure with no StigmerProvider, the help line drawing nothing", () => {
    const { container } = render(
      <StandaloneScreen help>
        <ErrorMessage error={new Error("sign-in is on, but no client is set up")} title="Stigmer couldn't load its setup." />
      </StandaloneScreen>,
    );
    expect(screen.getByRole("alert").textContent).toContain("Stigmer couldn't load its setup.");
    expect(container.textContent).not.toContain("Stuck?");
  });
});
