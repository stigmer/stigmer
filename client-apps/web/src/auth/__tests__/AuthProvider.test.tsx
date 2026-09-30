// ---------------------------------------------------------------------------
// AuthProvider and resolveAuthConfig — the runtime config picks the provider
//
// The console serves two auth modes from one bundle. `disabled` (the
// single-user laptop) must mount the inline provider that reports a signed-in
// visitor with no token; `oidc` (Stigmer Cloud, a self-host with an issuer)
// must mount the OIDC provider with exactly the issuer, client and audience
// the runtime config carries. A wrong pick here either locks a laptop user
// out or lets an OIDC deployment run without a session, so both directions
// are pinned, through the real resolveAuthConfig.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RuntimeConfig } from "@/config/runtime-config";
import type { OidcConfig } from "../oidc/types";
import { useAuth } from "../use-auth";

const runtime = vi.hoisted(() => ({
  config: null as RuntimeConfig | null,
}));

vi.mock("@/config/runtime-config", () => ({
  getRuntimeConfig: () => {
    if (!runtime.config) throw new Error("runtime config not loaded");
    return runtime.config;
  },
}));

const oidc = vi.hoisted(() => ({
  configs: [] as OidcConfig[],
}));

vi.mock("../oidc/OidcAuthProvider", () => ({
  default: ({
    config,
    children,
  }: {
    config: OidcConfig;
    children: React.ReactNode;
  }) => {
    oidc.configs.push(config);
    return <div data-testid="oidc-provider">{children}</div>;
  },
}));

import { AuthProvider } from "../AuthProvider";
import { resolveAuthConfig } from "../config";

const BASE: RuntimeConfig = {
  apiUrl: "http://localhost:7234",
  appUrl: "",
  authMode: "disabled",
  oidcIssuer: "",
  oidcClientId: "",
  oidcAudience: "https://api.stigmer.com/",
};

const OIDC: RuntimeConfig = {
  ...BASE,
  authMode: "oidc",
  oidcIssuer: "https://issuer.example.com/",
  oidcClientId: "console-client",
  oidcAudience: "https://api.example.com/",
};

function AuthProbe() {
  const state = useAuth();
  return (
    <p>
      authenticated={String(state.isAuthenticated)} loading=
      {String(state.isLoading)} token={String(state.accessToken)} user=
      {String(state.user)}
    </p>
  );
}

describe("resolveAuthConfig", () => {
  beforeEach(() => {
    runtime.config = null;
  });

  it("answers disabled, carrying nothing, for a disabled runtime config", () => {
    runtime.config = BASE;
    expect(resolveAuthConfig()).toEqual({ mode: "disabled" });
  });

  it("carries the runtime config's issuer, client and audience in oidc mode", () => {
    runtime.config = OIDC;
    expect(resolveAuthConfig()).toEqual({
      mode: "oidc",
      oidc: {
        issuer: "https://issuer.example.com/",
        clientId: "console-client",
        audience: "https://api.example.com/",
      },
    });
  });

  it("refuses a mode it does not serve instead of falling back to disabled", () => {
    runtime.config = { ...BASE, authMode: "saml" as RuntimeConfig["authMode"] };
    expect(() => resolveAuthConfig()).toThrow('Invalid auth mode: "saml"');
  });
});

describe("AuthProvider", () => {
  beforeEach(() => {
    runtime.config = null;
    oidc.configs = [];
  });

  it("mounts the disabled provider, which reports a signed-in visitor with no token or user", () => {
    runtime.config = BASE;
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    expect(
      screen.getByText("authenticated=true loading=false token=null user=null"),
    ).toBeTruthy();
    expect(screen.queryByTestId("oidc-provider")).toBeNull();
  });

  it("mounts the OIDC provider with the resolved config in oidc mode, and not the disabled one", async () => {
    runtime.config = OIDC;
    render(
      <AuthProvider>
        <p>inside</p>
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("oidc-provider")).toBeTruthy(),
    );
    expect(screen.getByText("inside")).toBeTruthy();
    expect(oidc.configs.at(-1)).toEqual({
      issuer: "https://issuer.example.com/",
      clientId: "console-client",
      audience: "https://api.example.com/",
    });
  });

  it("gives the disabled provider's login and logout as no-ops", async () => {
    runtime.config = BASE;
    function Controls() {
      const { login, logout } = useAuth();
      return (
        <>
          <button onClick={login}>sign in</button>
          <button onClick={logout}>sign out</button>
        </>
      );
    }
    render(
      <AuthProvider>
        <Controls />
        <AuthProbe />
      </AuthProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "sign in" }));
    await userEvent.click(screen.getByRole("button", { name: "sign out" }));
    // Still signed in, with nothing to hand the transport.
    expect(
      screen.getByText("authenticated=true loading=false token=null user=null"),
    ).toBeTruthy();
  });
});

describe("useAuth", () => {
  it("throws outside an AuthProvider so a wiring mistake surfaces at once", () => {
    function Orphan() {
      useAuth();
      return null;
    }
    // React logs the thrown render error; keep the test output clean.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Orphan />)).toThrow(
      "useAuth must be used within <AuthProvider>",
    );
    spy.mockRestore();
  });
});
