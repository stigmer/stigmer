/**
 * Pins the identity account gate's screens, which both consoles draw: the
 * app only once the account is ready; a quiet wait while it's checked; the
 * welcome by name while a first account is set up; the failure with the
 * server's line, Try again and the help line (CON-13); and the host's
 * corner (who is signed in, Sign out) on every screen a person can be stuck on.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { IdentityAccount } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountGateView } from "../IdentityAccountGateView";

// The help line reads the server's answer; here it stands in, so the test
// holds where the gate places it.
vi.mock("../../help/HelpLink.js", () => ({ HelpLink: () => <p>Stuck? Talk to us</p> }));

afterEach(cleanup);

const corner = <button type="button">Sign out</button>;

describe("IdentityAccountGateView", () => {
  it("draws the app once the account is ready", () => {
    render(
      <IdentityAccountGateView state={{ status: "ready", account: {} as IdentityAccount }} retry={vi.fn()} corner={corner}>
        <p>the app</p>
      </IdentityAccountGateView>,
    );
    expect(screen.getByText("the app")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("holds the app back while the account is checked, without the corner", () => {
    render(
      <IdentityAccountGateView state={{ status: "checking" }} retry={vi.fn()} corner={corner}>
        <p>the app</p>
      </IdentityAccountGateView>,
    );
    expect(screen.queryByText("the app")).toBeNull();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("welcomes a first-time visitor by name while their account is set up", () => {
    render(<IdentityAccountGateView state={{ status: "provisioning" }} retry={vi.fn()} displayName="Ada" corner={corner} />);
    expect(screen.getByRole("heading", { level: 1, name: "Welcome, Ada!" })).toBeTruthy();
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.getByText("Setting up your account…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });

  it("welcomes a visitor with no name plainly", () => {
    render(<IdentityAccountGateView state={{ status: "provisioning" }} retry={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Welcome!" })).toBeTruthy();
  });

  it("shows the failure with its message, the help line and the corner, and retries on request", async () => {
    const retry = vi.fn();
    render(
      <IdentityAccountGateView state={{ status: "error", message: "whoAmI failed" }} retry={retry} corner={corner}>
        <p>the app</p>
      </IdentityAccountGateView>,
    );
    expect(screen.queryByText("the app")).toBeNull();
    expect(screen.getByText("Failed to set up your account")).toBeTruthy();
    expect(screen.getByText("whoAmI failed")).toBeTruthy();
    expect(screen.getByText("Stuck? Talk to us")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
