// ---------------------------------------------------------------------------
// LoginPageView — one sign-in on every edition
//
// /login is the signed-out landing. Every edition signs in through the
// deployment's own issuer, so the page is the logo and one "Sign in"
// button, and that button starts the configured issuer's flow with the
// post-login path set to the console's home.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  signinRedirect: vi.fn(),
  createUserManager: vi.fn(),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));
vi.mock("@stigmer/sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stigmer/sdk")>()),
  Stigmer: class {},
}));
vi.mock("@stigmer/react", () => ({
  StigmerProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/config/env", () => ({
  getApiBaseUrl: () => "https://stigmer.example.com",
}));
vi.mock("@/auth/config", () => ({
  resolveAuthConfig: () => ({
    mode: "oidc",
    oidc: {
      issuer: "https://issuer.example.com/",
      clientId: "console",
      audience: "https://api.example.com",
    },
  }),
}));
vi.mock("@/auth/oidc/oidc-manager", () => ({
  createUserManager: mocks.createUserManager,
}));

import { LoginPageView } from "../LoginPageView";

describe("LoginPageView", () => {
  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    mocks.createUserManager.mockReset();
    mocks.signinRedirect.mockReset();
  });

  it("shows one 'Sign in' button and nothing else to press", () => {
    render(<LoginPageView />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("starts the configured issuer's flow and returns home after it", () => {
    mocks.createUserManager.mockReturnValue({
      signinRedirect: mocks.signinRedirect,
    });
    render(<LoginPageView />);

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(mocks.createUserManager).toHaveBeenCalledWith({
      issuer: "https://issuer.example.com/",
      clientId: "console",
      audience: "https://api.example.com",
    });
    expect(mocks.signinRedirect).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("stigmer:auth:redirect_path")).toBe("/");
  });
});
