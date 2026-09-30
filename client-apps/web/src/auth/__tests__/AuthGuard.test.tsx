// ---------------------------------------------------------------------------
// AuthGuard — nothing behind the guard renders for a signed-out visitor
//
// The guard is the one place the authenticated chain turns a visitor away:
// while the stored session resolves it shows a spinner, once it knows the
// visitor is signed out it starts the sign-in redirect (once) and says so,
// and only a signed-in visitor sees the children. Disabled-auth mode reaches
// the last branch at once, because its provider always reports signed in.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AuthState } from "../types";

const auth = vi.hoisted(() => ({
  state: null as AuthState | null,
}));

vi.mock("../use-auth", () => ({
  useAuth: () => auth.state,
}));

import { AuthGuard } from "../AuthGuard";

function authState(overrides: Partial<AuthState>): AuthState {
  return {
    isAuthenticated: false,
    isLoading: false,
    user: null,
    accessToken: null,
    login: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  };
}

function renderGuard() {
  return render(
    <AuthGuard>
      <p>protected content</p>
    </AuthGuard>,
  );
}

describe("AuthGuard", () => {
  beforeEach(() => {
    auth.state = null;
  });

  it("renders the children for a signed-in visitor and starts no sign-in", () => {
    auth.state = authState({ isAuthenticated: true });
    renderGuard();

    expect(screen.getByText("protected content")).toBeTruthy();
    expect(auth.state.login).not.toHaveBeenCalled();
  });

  it("shows the loading wait, not the children, while the session resolves", () => {
    auth.state = authState({ isLoading: true });
    renderGuard();

    expect(screen.queryByText("protected content")).toBeNull();
    expect(screen.getByText("Loading...")).toBeTruthy();
    expect(auth.state.login).not.toHaveBeenCalled();
  });

  it("starts the sign-in redirect exactly once for a signed-out visitor and never renders the children", () => {
    auth.state = authState({});
    const { rerender } = renderGuard();

    expect(screen.queryByText("protected content")).toBeNull();
    expect(screen.getByText("Redirecting you to sign in…")).toBeTruthy();

    // A re-render with the same state must not start a second redirect.
    rerender(
      <AuthGuard>
        <p>protected content</p>
      </AuthGuard>,
    );
    expect(auth.state.login).toHaveBeenCalledTimes(1);
  });

  it("starts the redirect when a resolving session turns out signed out", () => {
    auth.state = authState({ isLoading: true });
    const { rerender } = renderGuard();
    expect(auth.state.login).not.toHaveBeenCalled();

    const login = auth.state.login;
    auth.state = authState({ isLoading: false, login });
    rerender(
      <AuthGuard>
        <p>protected content</p>
      </AuthGuard>,
    );

    expect(login).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("protected content")).toBeNull();
  });
});
