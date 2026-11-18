/**
 * Pins the identity account gate's screens, which both consoles draw on the
 * standalone frame: the app only once the account is ready; "Checking your
 * account…" while it's checked; the welcome by name while a first account is
 * set up; a failure said from its kind ("Stigmer couldn't set up your
 * account." with what wasn't lost and Try again, or the signed-out sentence
 * with Sign in again), never the raw line alone, with the help line (CON-13);
 * and the host's mark and corner on every screen a person can be stuck on.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Code, ConnectError } from "@connectrpc/connect";
import type { IdentityAccount } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountGateView } from "../IdentityAccountGateView";

// The help line reads the server's answer; here it stands in, so the test
// holds where the gate places it.
vi.mock("../../help/HelpLink.js", () => ({
  HelpLink: () => <p>Stuck? Talk to us</p>,
  FailureHelpLine: () => <p>Stuck? Talk to us</p>,
}));

afterEach(cleanup);

const corner = <button type="button">Sign out</button>;
const mark = <span>the mark</span>;
const unavailable = new ConnectError("the server did not answer in time", Code.Unavailable);

describe("IdentityAccountGateView", () => {
  it("draws the app once the account is ready", () => {
    render(
      <IdentityAccountGateView state={{ status: "ready", account: {} as IdentityAccount }} retry={vi.fn()} corner={corner} mark={mark}>
        <p>the app</p>
      </IdentityAccountGateView>,
    );
    expect(screen.getByText("the app")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("says it is checking the account, under the mark, with the corner", () => {
    render(
      <IdentityAccountGateView state={{ status: "checking" }} retry={vi.fn()} corner={corner} mark={mark}>
        <p>the app</p>
      </IdentityAccountGateView>,
    );
    expect(screen.queryByText("the app")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("Checking your account…");
    expect(screen.getByText("the mark")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("welcomes a first-time visitor by name while their account is set up", () => {
    render(<IdentityAccountGateView state={{ status: "provisioning" }} retry={vi.fn()} displayName="Ada" corner={corner} />);
    expect(screen.getByRole("heading", { level: 1, name: "Welcome, Ada" })).toBeTruthy();
    expect(screen.getByText("Setting up your account…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("welcomes a visitor with no name plainly", () => {
    render(<IdentityAccountGateView state={{ status: "provisioning" }} retry={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Welcome" })).toBeTruthy();
  });

  it("says the failure in plain words, keeps the server's line one step down, and retries on request", async () => {
    const retry = vi.fn();
    render(
      <IdentityAccountGateView state={{ status: "error", message: unavailable.message, error: unavailable }} retry={retry} corner={corner}>
        <p>the app</p>
      </IdentityAccountGateView>,
    );
    expect(screen.queryByText("the app")).toBeNull();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Stigmer couldn't set up your account.");
    expect(alert.textContent).toContain("You're signed in, and nothing was lost.");
    expect(alert.textContent).not.toContain("Failed to set up your account");
    expect(screen.getByText("Stuck? Talk to us")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("says a signed-out failure as such and offers Sign in again, not Try again", async () => {
    const signIn = vi.fn();
    const signedOut = new ConnectError("your session ended", Code.Unauthenticated);
    render(<IdentityAccountGateView state={{ status: "error", message: signedOut.message, error: signedOut }} retry={vi.fn()} signIn={signIn} />);
    expect(screen.getByRole("alert").textContent).toContain("You're signed out.");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Sign in again" }));
    expect(signIn).toHaveBeenCalledTimes(1);
  });
});
