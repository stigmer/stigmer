// ---------------------------------------------------------------------------
// LoginScreen — signing in to the server the app points at
//
// The screen names the server (as the server's own answer named it), opens
// the sign-in on one press, waits for the browser with Reopen and Cancel,
// treats a cancel as no failure, says why a sign-in failed, and offers
// another server. The sign-in itself and the server are stubbed; the flow is
// pinned in AuthProvider.test.tsx and src-tauri/src/oidc.rs.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockTauri } from "../../__test-utils__/tauri";

const auth = vi.hoisted(() => ({ login: vi.fn<() => Promise<void>>() }));
vi.mock("../AuthProvider", () => ({
  SIGN_IN_CANCELLED: "Sign-in cancelled.",
  useAuth: () => ({ login: auth.login }),
}));
const server = vi.hoisted(() => ({ label: "Stigmer Cloud", setChoosing: vi.fn() }));
vi.mock("../../server/ServerProvider", () => ({ useServer: () => server }));

import { LoginScreen } from "../LoginScreen";

beforeEach(() => {
  auth.login.mockReset();
  server.setChoosing.mockReset();
  server.label = "Stigmer Cloud";
});

describe("DSK-02 LoginScreen", () => {
  it("names the server it signs in to, as the server named itself", () => {
    server.label = "stigmer.acme.internal";
    render(<LoginScreen />);
    expect(screen.getByRole("button", { name: "Sign in to stigmer.acme.internal" })).toBeTruthy();
  });

  it("waits for the browser with Reopen and Cancel, and treats a cancel as no failure", async () => {
    let settle: (reason: unknown) => void = () => {};
    auth.login.mockReturnValue(new Promise<void>((_resolve, reject) => (settle = reject)));
    const tauri = mockTauri({ auth_reopen_browser: () => null, auth_cancel: () => null });
    render(<LoginScreen />);

    await userEvent.click(screen.getByRole("button", { name: "Sign in to Stigmer Cloud" }));
    expect(screen.getByText("Completing sign-in in your browser…")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Reopen browser" }));
    expect(tauri.callsTo("auth_reopen_browser")).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(tauri.callsTo("auth_cancel")).toHaveLength(1);
    settle("Sign-in cancelled.");
    expect(await screen.findByRole("button", { name: "Sign in to Stigmer Cloud" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says why a sign-in failed, and offers to try again", async () => {
    auth.login.mockRejectedValue("The sign-in provider refused the sign-in: access_denied");
    render(<LoginScreen />);

    await userEvent.click(screen.getByRole("button", { name: "Sign in to Stigmer Cloud" }));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "The sign-in provider refused the sign-in: access_denied",
    );
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByRole("button", { name: "Sign in to Stigmer Cloud" })).toBeTruthy();
  });

  it("offers another server", async () => {
    render(<LoginScreen />);
    await userEvent.click(screen.getByRole("button", { name: "Use another server" }));
    expect(server.setChoosing).toHaveBeenCalledWith(true);
  });
});
