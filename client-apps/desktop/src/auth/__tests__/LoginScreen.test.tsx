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

const auth = vi.hoisted(() => ({
  login: vi.fn<(options?: { providerConfirmed?: boolean }) => Promise<void>>(),
  provider: { host: "id.stigmer.ai", sameSite: true } as { host: string; sameSite: boolean } | null,
}));
vi.mock("../AuthProvider", () => ({
  SIGN_IN_CANCELLED: "Sign-in cancelled.",
  useAuth: () => ({ login: auth.login, provider: auth.provider }),
}));
const server = vi.hoisted(() => ({
  label: "Stigmer Cloud",
  origin: "https://api.stigmer.ai",
  setChoosing: vi.fn(),
}));
vi.mock("../../server/ServerProvider", () => ({ useServer: () => server }));

import { LoginScreen } from "../LoginScreen";

beforeEach(() => {
  auth.login.mockReset();
  server.setChoosing.mockReset();
  server.label = "Stigmer Cloud";
  server.origin = "https://api.stigmer.ai";
  auth.provider = { host: "id.stigmer.ai", sameSite: true };
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

  it("signs in on one press, with no question, at a provider on the server's own site", async () => {
    auth.login.mockResolvedValue();
    render(<LoginScreen />);
    expect(screen.queryByText(/on another site/)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Sign in to Stigmer Cloud" }));

    expect(auth.login).toHaveBeenCalledWith({ providerConfirmed: false });
  });

  it("names both hosts before sending a person to a provider on another site", async () => {
    // A server a person was talked into choosing can announce a company's
    // real provider to collect its tokens. The person sees whose account
    // this server wants, by the server's address, never by the name the
    // server gave itself.
    server.label = "Stigmer Cloud";
    server.origin = "https://evil.example";
    auth.provider = { host: "id.acme.com", sameSite: false };
    auth.login.mockResolvedValue();
    render(<LoginScreen />);

    expect(screen.getByText("evil.example signs people in at id.acme.com, on another site.")).toBeTruthy();
    expect(screen.getByText("Go on only if you trust evil.example with your id.acme.com account.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign in to Stigmer Cloud" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Sign in at id.acme.com" }));

    expect(auth.login).toHaveBeenCalledWith({ providerConfirmed: true });
  });

  it("offers no sign-in until it knows where the server sends people", () => {
    auth.provider = null;
    render(<LoginScreen />);
    expect(screen.queryByRole("button", { name: /^Sign in/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Use another server" })).toBeTruthy();
  });

  it("offers another server", async () => {
    render(<LoginScreen />);
    await userEvent.click(screen.getByRole("button", { name: "Use another server" }));
    expect(server.setChoosing).toHaveBeenCalledWith(true);
  });
});
