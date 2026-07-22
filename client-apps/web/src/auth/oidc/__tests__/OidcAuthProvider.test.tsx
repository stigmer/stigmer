// ---------------------------------------------------------------------------
// OidcAuthProvider — callback single-flight regression tests
//
// The /auth/callback code exchange redeems a one-time authorization code.
// React StrictMode (on by default in Next.js dev) runs mount effects twice,
// so without single-flighting the provider would redeem the code twice —
// the identity provider rejects the second attempt with `invalid_grant`
// ("Invalid authorization code") — and the second run would consume an
// already-deleted redirect path, clobbering the post-login destination
// with "/".
//
// The single-flight memo is module state, so each test re-imports the
// provider via vi.resetModules() + dynamic import instead of a test-only
// reset hook — production code stays free of test scaffolding.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrictMode } from "react";
import { render, waitFor } from "@testing-library/react";
import type { User } from "oidc-client-ts";
import type { OidcConfig } from "../types";

const REDIRECT_PATH_KEY = "stigmer:auth:redirect_path";
const SAVED_PATH = "/agents?tab=all";

const CONFIG: OidcConfig = {
  issuer: "https://auth.example.com",
  clientId: "test-client",
  audience: "https://api.example.com/",
};

const mocks = vi.hoisted(() => {
  const user = {
    access_token: "token-123",
    expired: false,
    profile: { email: "user@example.com" },
  } as unknown as User;

  const manager = {
    signinRedirectCallback: vi.fn(async () => user),
    getUser: vi.fn(async () => null),
    signinRedirect: vi.fn(),
    signoutRedirect: vi.fn(),
    removeUser: vi.fn(),
    events: {
      addUserLoaded: vi.fn(),
      addUserUnloaded: vi.fn(),
      addAccessTokenExpired: vi.fn(),
      removeUserLoaded: vi.fn(),
      removeUserUnloaded: vi.fn(),
      removeAccessTokenExpired: vi.fn(),
    },
  };

  return { user, manager };
});

vi.mock("../oidc-manager", () => ({
  createUserManager: vi.fn(() => mocks.manager),
}));

/** Re-import the provider so its module-scoped single-flight memo is fresh. */
async function importProvider() {
  const { default: OidcAuthProvider } = await import("../OidcAuthProvider");
  return OidcAuthProvider;
}

/** Render the provider at /auth/callback under StrictMode (double effects). */
async function renderAtCallback() {
  const OidcAuthProvider = await importProvider();
  return render(
    <StrictMode>
      <OidcAuthProvider config={CONFIG}>
        <div>app</div>
      </OidcAuthProvider>
    </StrictMode>,
  );
}

describe("OidcAuthProvider callback single-flight", () => {
  let replaceSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    sessionStorage.clear();
    sessionStorage.setItem(REDIRECT_PATH_KEY, SAVED_PATH);

    // happy-dom exposes URL control on window.happyDOM (not in DOM types).
    const happyDom = (
      window as unknown as { happyDOM: { setURL(url: string): void } }
    ).happyDOM;
    happyDom.setURL("http://localhost:3000/auth/callback");
    replaceSpy = vi.fn();
    vi.spyOn(window.location, "replace").mockImplementation(replaceSpy);
  });

  it("redeems the authorization code exactly once under StrictMode", async () => {
    await renderAtCallback();

    await waitFor(() => expect(replaceSpy).toHaveBeenCalled());
    // Guard against a vacuous pass: prove StrictMode actually ran the
    // mount effect twice (each run registers the userLoaded listener).
    expect(
      mocks.manager.events.addUserLoaded.mock.calls.length,
    ).toBeGreaterThanOrEqual(2);
    expect(mocks.manager.signinRedirectCallback).toHaveBeenCalledTimes(1);
  });

  it("navigates every effect run to the saved redirect path, never '/'", async () => {
    await renderAtCallback();

    await waitFor(() => expect(replaceSpy).toHaveBeenCalled());
    for (const call of replaceSpy.mock.calls) {
      expect(call[0]).toBe(SAVED_PATH);
    }
    expect(sessionStorage.getItem(REDIRECT_PATH_KEY)).toBeNull();
  });
});
