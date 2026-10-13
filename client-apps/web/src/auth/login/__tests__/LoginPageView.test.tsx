// ---------------------------------------------------------------------------
// LoginPageView — shaped by the edition's tiers, not by a guess
//
// /login is the signed-out landing. Its shape follows the codebase's one
// mechanism for "what does this edition serve": the SSO organization prompt
// renders only where `identity_provider` is available (tier enterprise, so
// Enterprise and Cloud); everywhere else the page is the logo and one "Sign
// in" button — the configured issuer's flow, which the SSO editions label
// "Sign in with email" beside the prompt. Until the server has answered
// getServerInfo the page shows its skeleton, never the hostname guess.
//
// An organization that requires sign-in through its SSO provider (the prompt
// reports a provider with `ssoRequired`) gets no "Sign in with email"
// button, only an owner's quiet link to the configured issuer.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { DeploymentMode } from "@stigmer/sdk";

const mocks = vi.hoisted(() => ({
  deployment: { mode: "cloud" as DeploymentMode, resolved: false },
  found: null as { displayName: string; ssoRequired: boolean } | null,
  redirected: [] as string[],
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));
// The tier mechanism (`isResourceAvailable`) stays real: it is the thing
// under test. Only the client constructor is stubbed.
vi.mock("@stigmer/sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stigmer/sdk")>()),
  Stigmer: class {},
}));
vi.mock("@stigmer/react", async () => {
  const { useEffect } = await import("react");
  return {
    StigmerProvider: ({ children }: { children: React.ReactNode }) => children,
    SsoLoginPrompt: ({
      onProviderChange,
      onSsoLogin,
    }: {
      onProviderChange?: (
        provider: { displayName: string; ssoRequired: boolean } | null,
      ) => void;
      onSsoLogin: (
        provider: { displayName: string; issuer: string },
        org: string,
      ) => void;
    }) => {
      useEffect(() => onProviderChange?.(mocks.found), [onProviderChange]);
      return (
        <div data-testid="sso-prompt">
          <button
            type="button"
            onClick={() =>
              onSsoLogin(
                { displayName: "Acme Okta", issuer: "https://acme.okta.test" },
                "acme",
              )
            }
          >
            Sign in with Acme Okta
          </button>
        </div>
      );
    },
  };
});
vi.mock("@/config/env", () => ({
  getApiBaseUrl: () => "https://stigmer.example.com",
}));
vi.mock("@/auth/config", () => ({
  resolveAuthConfig: () => ({ mode: "disabled" }),
}));
vi.mock("@/auth/oidc/oidc-manager", () => ({
  createUserManager: (config: { issuer: string }) => ({
    signinRedirect: () => {
      mocks.redirected.push(config.issuer);
      return Promise.resolve();
    },
  }),
}));
vi.mock("@/domain/_shared/hooks/useDeploymentMode", () => ({
  useDeploymentMode: () => mocks.deployment,
}));

import { LoginPageView } from "../LoginPageView";

describe("LoginPageView", () => {
  beforeEach(() => {
    mocks.deployment = { mode: "cloud", resolved: false };
    mocks.found = null;
    mocks.redirected = [];
  });

  afterEach(cleanup);

  it("shows the skeleton and no sign-in controls until the server has answered", () => {
    render(<LoginPageView />);
    expect(screen.queryByTestId("sso-prompt")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("open source: one 'Sign in' button, no organization prompt", () => {
    mocks.deployment = { mode: "local", resolved: true };
    render(<LoginPageView />);
    expect(screen.queryByTestId("sso-prompt")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it.each<DeploymentMode>(["enterprise", "cloud"])(
    "%s: the SSO organization prompt beside 'Sign in with email'",
    (mode) => {
      mocks.deployment = { mode, resolved: true };
      render(<LoginPageView />);
      expect(screen.getByTestId("sso-prompt")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Sign in with email" }),
      ).toBeTruthy();
    },
  );

  it("an organization that requires its SSO: no 'Sign in with email' button, only an owner's link", async () => {
    mocks.deployment = { mode: "cloud", resolved: true };
    mocks.found = { displayName: "Acme Okta", ssoRequired: true };
    render(<LoginPageView />);
    expect(
      await screen.findByText(
        /This organization requires sign-in through Acme Okta/,
      ),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Sign in with email" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Owner? Sign in with email" }),
    ).toBeTruthy();
  });

  it("an organization that does not require it keeps the email button", async () => {
    mocks.deployment = { mode: "cloud", resolved: true };
    mocks.found = { displayName: "Acme Okta", ssoRequired: false };
    render(<LoginPageView />);
    expect(
      await screen.findByRole("button", { name: "Sign in with email" }),
    ).toBeTruthy();
  });

  it("signs in through the organization's provider from the prompt", () => {
    mocks.deployment = { mode: "enterprise", resolved: true };
    render(<LoginPageView />);
    screen.getByRole("button", { name: "Sign in with Acme Okta" }).click();
    expect(mocks.redirected).toEqual(["https://acme.okta.test"]);
  });
});
