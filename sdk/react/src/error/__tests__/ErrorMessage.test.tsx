/**
 * Pins the console's failure note: a plain sentence per category when the
 * page gives no headline (never "Server error"), the page's own headline
 * when it does, the error's own message under it, the page's comfort when
 * it knows one, "Try again" only where trying again can help, "Sign in
 * again" for a signed-out error when the host can sign in, Copy details
 * always, and nothing at all with no error.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Code, ConnectError } from "@connectrpc/connect";
import { ErrorMessage } from "../ErrorMessage";

afterEach(cleanup);

describe("ErrorMessage", () => {
  it.each([
    [Code.Unauthenticated, "You're signed out."],
    [Code.PermissionDenied, "You don't have access to this."],
    [Code.NotFound, "This isn't here any more."],
    [Code.InvalidArgument, "Stigmer couldn't accept that."],
    [Code.Internal, "Something went wrong on Stigmer's side."],
    [Code.Unavailable, "Stigmer didn't answer."],
    [Code.Canceled, "That was cancelled before it finished."],
  ])("heads a code-%i failure with a sentence, not a category", (code, headline) => {
    render(<ErrorMessage error={new ConnectError("the reason", code)} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(headline);
    expect(alert.textContent).not.toMatch(/Server error|Service unavailable|Access denied|Authentication required/);
  });

  it("heads with the page's words, keeps the error's own line, and adds the page's comfort", () => {
    render(
      <ErrorMessage
        error={new ConnectError("database is restarting", Code.Unavailable)}
        title="Couldn't load the shared vaults."
        comfort="Your organization's vaults are safe; only this page's read failed."
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Couldn't load the shared vaults.");
    expect(alert.textContent).toContain("database is restarting");
    expect(screen.getByText("Your organization's vaults are safe; only this page's read failed.")).toBeTruthy();
  });

  it("offers Try again where trying again can help, and not where it can't", () => {
    const retry = vi.fn();
    const { rerender } = render(<ErrorMessage error={new ConnectError("x", Code.Unavailable)} retry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);

    // A cancelled read was stopped, not refused: asking again can finish it.
    rerender(<ErrorMessage error={new ConnectError("x", Code.Canceled)} retry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(2);

    rerender(<ErrorMessage error={new ConnectError("x", Code.PermissionDenied)} retry={retry} />);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("offers Sign in again for a signed-out failure when the host can sign in", () => {
    const signIn = vi.fn();
    render(<ErrorMessage error={new ConnectError("x", Code.Unauthenticated)} retry={() => {}} signIn={signIn} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    expect(signIn).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("always offers Copy details, and draws nothing with no error", () => {
    const { rerender, container } = render(<ErrorMessage error={new ConnectError("x", Code.NotFound)} />);
    expect(screen.getByRole("button", { name: "Copy details" })).toBeTruthy();
    rerender(<ErrorMessage error={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("draws on the failed tone with the foreground text, not red text on red", () => {
    render(<ErrorMessage error={new ConnectError("x", Code.Internal)} />);
    const alert = screen.getByRole("alert");
    expect(alert.className).toContain("stg:bg-status-failed-subtle");
    expect(alert.className).not.toContain("stg:text-destructive");
    expect(alert.className).not.toContain("/20");
  });
});
