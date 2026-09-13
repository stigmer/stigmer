// ---------------------------------------------------------------------------
// LoginPageView — shaped by the edition's tiers, not by a guess
//
// /login is the signed-out landing (20260913.02, sp.console-login Q-CL-4,
// Q-CL-9). Its shape follows the codebase's one mechanism for "what does
// this edition serve": the SSO organization prompt renders only where
// `identity_provider` is available (tier enterprise, so Enterprise and
// Cloud); everywhere else the page is the logo and one "Sign in" button —
// the configured issuer's flow, which the SSO editions label "Sign in with
// email" beside the prompt. Until the server has answered getServerInfo
// the page shows its skeleton, never the hostname guess (finding 6).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { DeploymentMode } from "@stigmer/sdk";

const mocks = vi.hoisted(() => ({
  deployment: { mode: "cloud" as DeploymentMode, resolved: false },
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));
vi.mock("@stigmer/sdk", () => ({
  Stigmer: class {},
}));
vi.mock("@stigmer/react", () => ({
  StigmerProvider: ({ children }: { children: React.ReactNode }) => children,
  SsoLoginPrompt: () => <div data-testid="sso-prompt" />,
}));
vi.mock("@/config/env", () => ({
  getApiBaseUrl: () => "https://stigmer.example.com",
}));
vi.mock("@/auth/config", () => ({
  resolveAuthConfig: () => ({ mode: "disabled" }),
}));
vi.mock("@/auth/oidc/oidc-manager", () => ({
  createUserManager: vi.fn(),
}));
vi.mock("@/domain/_shared/hooks/useDeploymentMode", () => ({
  useDeploymentMode: () => mocks.deployment,
}));

import { LoginPageView } from "../LoginPageView";

describe("LoginPageView", () => {
  beforeEach(() => {
    mocks.deployment = { mode: "cloud", resolved: false };
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
});
