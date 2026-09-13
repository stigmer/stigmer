// ---------------------------------------------------------------------------
// oidc-manager — the UserManager the console hands oidc-client-ts
//
// Pins the two URIs an operator registers with their identity provider
// (20260913.02, sp.console-login): the redirect URI is `/auth/callback` on
// the console's own origin, and the post-logout URI is `/login` on the same
// origin (Q-CL-9) — one signed-out landing for both logout arms, and the
// one pair of URIs the authentication guide tells the operator to register.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { createUserManager } from "../oidc-manager";

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
