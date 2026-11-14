// ---------------------------------------------------------------------------
// oidc-manager — the UserManager the console hands oidc-client-ts
//
// Pins the two URIs an operator registers with their identity provider:
// the redirect URI is `/auth/callback` on the console's own origin, and the
// post-logout URI is `/login` on the same origin — one signed-out landing for
// both logout arms, and the one pair of URIs the authentication guide tells
// the operator to register.
//
// Pins the sign-up request too: the deployment's own parameters when it
// set them (keeping `audience`, since a per-call map replaces the
// manager's), else the standard `prompt=create` only when discovery lists
// it, else an ordinary sign-in.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { OidcMetadata } from "oidc-client-ts";
import { createUserManager, signupRedirectArgs } from "../oidc-manager";
import type { OidcConfig } from "../types";

const ORIGIN = "https://stigmer.example.com";

describe("createUserManager: the URIs the operator registers", () => {
  beforeEach(() => {
    const happyDom = (
      window as unknown as { happyDOM: { setURL(url: string): void } }
    ).happyDOM;
    happyDom.setURL(`${ORIGIN}/sessions`);
  });

  it("returns to /auth/callback and, after sign-out, to /login on the console's origin", () => {
    const manager = createUserManager({
      issuer: "https://auth.example.com/realms/main",
      clientId: "stigmer-console",
      audience: "https://stigmer.example.com/",
    });
    expect(manager.settings.redirect_uri).toBe(`${ORIGIN}/auth/callback`);
    expect(manager.settings.post_logout_redirect_uri).toBe(`${ORIGIN}/login`);
  });

  it("uses Authorization Code + PKCE with no client secret", () => {
    const manager = createUserManager({
      issuer: "https://auth.example.com/realms/main",
      clientId: "stigmer-console",
      audience: "https://stigmer.example.com/",
    });
    expect(manager.settings.response_type).toBe("code");
    expect(manager.settings.client_secret).toBeUndefined();
  });
});

describe("signupRedirectArgs: asking the issuer for its create-account screen", () => {
  const BASE: OidcConfig = {
    issuer: "https://auth.example.com/realms/main",
    clientId: "stigmer-console",
    audience: "https://stigmer.example.com/",
  };

  beforeEach(() => {
    const happyDom = (
      window as unknown as { happyDOM: { setURL(url: string): void } }
    ).happyDOM;
    happyDom.setURL(`${ORIGIN}/login?signup=1`);
  });

  // The library's metadata type has no prompt_values_supported.
  type Discovery = Partial<OidcMetadata> & { prompt_values_supported?: unknown };

  function managerWithDiscovery(config: OidcConfig, discovery: () => Promise<Discovery>) {
    const manager = createUserManager(config);
    vi.spyOn(manager.metadataService, "getMetadata").mockImplementation(discovery);
    return manager;
  }

  it("sends the configured parameters and keeps the audience the manager sends", async () => {
    const config = { ...BASE, signupQueryParams: { hint: "signup" } };
    const discovery = vi.fn(async (): Promise<Discovery> => ({ prompt_values_supported: ["create"] }));
    const manager = managerWithDiscovery(config, discovery);

    const args = await signupRedirectArgs(config, manager);

    expect(args).toEqual({
      extraQueryParams: { audience: "https://stigmer.example.com/", hint: "signup" },
    });
    expect(discovery).not.toHaveBeenCalled();
  });

  it("asks with prompt=create when discovery lists it", async () => {
    const manager = managerWithDiscovery(BASE, async () => ({
      prompt_values_supported: ["none", "login", "consent", "create"],
    }));
    expect(await signupRedirectArgs(BASE, manager)).toEqual({ prompt: "create" });
  });

  it("asks with prompt=create when the configured parameters are empty", async () => {
    const config = { ...BASE, signupQueryParams: {} };
    const manager = managerWithDiscovery(config, async () => ({
      prompt_values_supported: ["create"],
    }));
    expect(await signupRedirectArgs(config, manager)).toEqual({ prompt: "create" });
  });

  it("is an ordinary sign-in when discovery does not list create", async () => {
    const manager = managerWithDiscovery(BASE, async () => ({
      prompt_values_supported: ["none", "login"],
    }));
    expect(await signupRedirectArgs(BASE, manager)).toEqual({});
  });

  it("is an ordinary sign-in when discovery publishes no prompt values", async () => {
    const manager = managerWithDiscovery(BASE, async () => ({
      authorization_endpoint: "https://auth.example.com/authorize",
    }));
    expect(await signupRedirectArgs(BASE, manager)).toEqual({});
  });

  it("is an ordinary sign-in when the field is not a list", async () => {
    const manager = managerWithDiscovery(BASE, async () => ({ prompt_values_supported: "create" }));
    expect(await signupRedirectArgs(BASE, manager)).toEqual({});
  });

  it("is an ordinary sign-in when discovery cannot be read", async () => {
    const manager = managerWithDiscovery(BASE, async () => {
      throw new Error("network down");
    });
    expect(await signupRedirectArgs(BASE, manager)).toEqual({});
  });
});
