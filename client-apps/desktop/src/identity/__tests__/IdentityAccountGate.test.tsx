// The desktop's wiring of the first-sign-in gate: the SDK hook is asked to
// run exactly when the app signs in against an identity provider, and the
// app behind the gate renders only once the person's account is ready. The
// whoAmI / provisionMyAccount flow itself is the SDK's, pinned by its own
// suite; here the hook is stubbed so each gate state can be held still. The
// screens are the kit's IdentityAccountGateView (its help line pinned there).

import { create } from "@bufbuild/protobuf";
import {
  IdentityAccountSchema,
  type IdentityAccount,
} from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import {
  useIdentityAccountGate,
  type IdentityAccountGateState,
} from "@stigmer/react-sdk";
import { StigmerError } from "@stigmer/client";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth, type AuthState } from "../../auth/AuthProvider";
import { IdentityAccountGate } from "../IdentityAccountGate";

vi.mock("@stigmer/react-sdk", async () => {
  const kit = await vi.importActual<typeof import("@stigmer/react-sdk")>("@stigmer/react-sdk");
  return {
    Button: kit.Button,
    IconButton: kit.IconButton,
    LinkButton: kit.LinkButton,
    useIdentityAccountGate: vi.fn(),
  };
});

vi.mock("../../auth/AuthProvider", () => ({
  useAuth: vi.fn(),
}));

const ACCOUNT: IdentityAccount = create(IdentityAccountSchema, {
  metadata: { id: "ida_desktop" },
});

const retry = vi.fn();
const login = vi.fn(async () => {});

function authAs(isAuthEnabled: boolean): void {
  const state: AuthState = {
    isAuthEnabled,
    isAuthenticated: true,
    isInitialized: true,
    user: isAuthEnabled
      ? { sub: "auth0|desktop", email: "ada@example.com", name: "Ada" }
      : null,
    getAccessToken: () => null,
    provider: null,
    login,
    logout: () => {},
  };
  vi.mocked(useAuth).mockReturnValue(state);
}

function gateIn(state: IdentityAccountGateState): void {
  vi.mocked(useIdentityAccountGate).mockReturnValue({ state, retry });
}

function renderGate(): void {
  render(
    <IdentityAccountGate>
      <p>the app</p>
    </IdentityAccountGate>,
  );
}

beforeEach(() => {
  authAs(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("IdentityAccountGate", () => {
  it("runs the first-sign-in step when the app signs in with an identity provider", () => {
    gateIn({ status: "checking" });
    renderGate();
    expect(useIdentityAccountGate).toHaveBeenCalledWith({ isEnabled: true });
  });

  it("stands aside when auth is disabled against a local server", () => {
    authAs(false);
    gateIn({ status: "ready", account: ACCOUNT });
    renderGate();
    expect(useIdentityAccountGate).toHaveBeenCalledWith({ isEnabled: false });
    expect(screen.getByText("the app")).toBeTruthy();
  });

  it("holds the app back while the account is being looked up", () => {
    gateIn({ status: "checking" });
    renderGate();
    expect(screen.queryByText("the app")).toBeNull();
  });

  it("tells a first-time person their account is being set up, and holds the app back", () => {
    gateIn({ status: "provisioning" });
    renderGate();
    expect(screen.getByRole("heading", { level: 1, name: "Welcome, Ada" })).toBeTruthy();
    expect(screen.getByText("Setting up your account…")).toBeTruthy();
    // The corner is the account menu, as the sidebar's foot draws it.
    expect(screen.getByText("Ada")).toBeTruthy();
    expect(screen.queryByText("the app")).toBeNull();
  });

  it("renders the app once the account is ready", () => {
    gateIn({ status: "ready", account: ACCOUNT });
    renderGate();
    expect(screen.getByText("the app")).toBeTruthy();
  });

  it("says setup failed in plain words, retries on request, and keeps the account menu reachable", () => {
    gateIn({ status: "error", message: "the server is unavailable", error: new Error("the server is unavailable") });
    renderGate();
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Stigmer couldn't set up your account.");
    expect(alert.textContent).toContain("the server is unavailable");
    expect(alert.textContent).toContain("You're signed in, and nothing was lost.");
    expect(screen.getByText("Ada")).toBeTruthy();
    expect(screen.queryByText("the app")).toBeNull();

    fireEvent.click(screen.getByText("Try again"));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("offers Sign in again through the app's own sign-in when the session ended", () => {
    const signedOut = new StigmerError("unauthenticated", "your session ended", 16);
    gateIn({ status: "error", message: signedOut.message, error: signedOut });
    renderGate();

    fireEvent.click(screen.getByText("Sign in again"));
    expect(login).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
  });
});
