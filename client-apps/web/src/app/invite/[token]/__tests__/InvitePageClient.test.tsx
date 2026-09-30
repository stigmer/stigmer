// ---------------------------------------------------------------------------
// InvitePageClient — the public invite page finds the visitor's own session
//
// The invite page lives outside the authenticated chain, so it detects the
// session itself. The redemption states belong to @stigmer/react's
// InvitationRedemption; what this shell owns, and this suite pins, is:
//
//   - disabled auth: the visitor counts as signed in, with no token;
//   - OIDC: the UserManager is built for the SSO issuer only when a valid SSO
//     session is stored, else for the configured issuer; an unexpired user's
//     token is what the page's client sends; an expired user is signed out;
//   - the auto-accept flag written before the sign-in redirect is consumed
//     exactly once, on the return with a live session;
//   - "sign in to accept" stores the way back and the flag, and redirects
//     through the right issuer; an accepted invitation lands in its org.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { Stigmer } from "@stigmer/sdk";
import type { AuthConfig } from "@/auth/types";
import type { OidcConfig } from "@/auth/oidc/types";

const REDIRECT_PATH_KEY = "stigmer:auth:redirect_path";
const AUTO_ACCEPT_KEY = "stigmer:invite:auto_accept";
const SSO_SESSION_KEY = "stigmer:sso:session";

const CONFIGURED: OidcConfig = {
  issuer: "https://auth.example.com/",
  clientId: "console-client",
  audience: "https://api.example.com/",
};

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push }) }));
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));
vi.mock("@/config/env", () => ({
  getApiBaseUrl: () => "https://api.example.test",
}));
vi.mock("@/domain/_shared/hooks/useStaticRouteParam", () => ({
  useStaticRouteParam: () => "invite-token",
}));

const authConfig = vi.hoisted(() => ({
  value: { mode: "disabled" } as AuthConfig,
}));
vi.mock("@/auth/config", () => ({ resolveAuthConfig: () => authConfig.value }));

interface FakeUser {
  access_token: string;
  expired: boolean;
}

const oidc = vi.hoisted(() => ({
  built: [] as OidcConfig[],
  user: null as FakeUser | null,
  signinRedirect: vi.fn(),
}));
vi.mock("@/auth/oidc/oidc-manager", () => ({
  createUserManager: (config: OidcConfig) => {
    oidc.built.push(config);
    return {
      getUser: async () => oidc.user,
      signinRedirect: oidc.signinRedirect,
    };
  },
}));

interface RedemptionProps {
  token: string;
  isAuthenticated: boolean;
  autoAccept: boolean;
  onAccepted: (invitation: { metadata?: { org?: string } }) => void;
  onAuthRequired: () => void;
}

const page = vi.hoisted(() => ({
  redemption: [] as RedemptionProps[],
  clients: [] as Stigmer[],
}));
vi.mock("@stigmer/react", () => ({
  StigmerProvider: ({
    client,
    children,
  }: {
    client: Stigmer;
    children: React.ReactNode;
  }) => {
    page.clients.push(client);
    return <>{children}</>;
  },
  InvitationRedemption: (props: RedemptionProps) => {
    page.redemption.push(props);
    return null;
  },
}));

import InvitePageClient from "../InvitePageClient";

const latest = () => page.redemption.at(-1) as RedemptionProps;

/** The Authorization header the page's current client sends. */
async function bearerSent(): Promise<string | null> {
  let seen: string | null = "unset";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen = new Headers(init?.headers).get("authorization");
      return new Response(null, {
        status: 200,
        headers: {
          "content-type": "application/grpc-web+proto",
          "grpc-status": "5",
        },
      });
    }),
  );
  await (page.clients.at(-1) as Stigmer).platform
    .getServerInfo()
    .catch(() => {});
  return seen;
}

describe("InvitePageClient", () => {
  beforeEach(() => {
    sessionStorage.clear();
    authConfig.value = { mode: "disabled" };
    oidc.built = [];
    oidc.user = null;
    oidc.signinRedirect.mockReset();
    nav.push.mockReset();
    page.redemption = [];
    page.clients = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hands the route's token to the redemption", () => {
    render(<InvitePageClient />);
    expect(latest().token).toBe("invite-token");
  });

  describe("disabled auth", () => {
    it("counts the visitor as signed in, with no token and no sign-in manager", async () => {
      render(<InvitePageClient />);

      expect(latest().isAuthenticated).toBe(true);
      expect(latest().autoAccept).toBe(false);
      expect(oidc.built).toEqual([]);
      expect(await bearerSent()).toBeNull();
    });

    it("does nothing when asked to sign in", () => {
      render(<InvitePageClient />);
      latest().onAuthRequired();

      expect(oidc.signinRedirect).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(AUTO_ACCEPT_KEY)).toBeNull();
    });
  });

  describe("OIDC", () => {
    beforeEach(() => {
      authConfig.value = { mode: "oidc", oidc: CONFIGURED };
    });

    it("starts signed out and builds the manager for the configured issuer when no SSO session is stored", async () => {
      render(<InvitePageClient />);

      expect(latest().isAuthenticated).toBe(false);
      await waitFor(() => expect(oidc.built).toEqual([CONFIGURED]));
    });

    it("builds the manager for the stored SSO issuer when the SSO session is valid", async () => {
      sessionStorage.setItem(
        SSO_SESSION_KEY,
        JSON.stringify({
          issuer: "https://sso.acme.example/",
          clientId: "acme-client",
          audience: "https://api.example.com/",
          org: "acme",
        }),
      );
      render(<InvitePageClient />);

      await waitFor(() =>
        expect(oidc.built.at(-1)).toEqual({
          issuer: "https://sso.acme.example/",
          clientId: "acme-client",
          audience: "https://api.example.com/",
        }),
      );
    });

    it("ignores an invalid SSO session and uses the configured issuer", async () => {
      sessionStorage.setItem(
        SSO_SESSION_KEY,
        JSON.stringify({
          issuer: "https://sso.acme.example/",
          clientId: "acme-client",
          audience: "",
          org: "",
        }),
      );
      render(<InvitePageClient />);

      await waitFor(() => expect(oidc.built.at(-1)).toEqual(CONFIGURED));
    });

    it("signs in an unexpired user and sends their token", async () => {
      oidc.user = { access_token: "user-token", expired: false };
      render(<InvitePageClient />);

      await waitFor(() => expect(latest().isAuthenticated).toBe(true));
      expect(await bearerSent()).toBe("Bearer user-token");
    });

    it("keeps an expired user signed out and sends no token", async () => {
      oidc.user = { access_token: "stale-token", expired: true };
      render(<InvitePageClient />);

      await waitFor(() => expect(oidc.built.length).toBeGreaterThan(0));
      expect(latest().isAuthenticated).toBe(false);
      expect(await bearerSent()).toBeNull();
    });

    it("consumes the auto-accept flag once, on the return with a live session", async () => {
      sessionStorage.setItem(AUTO_ACCEPT_KEY, "1");
      oidc.user = { access_token: "user-token", expired: false };
      render(<InvitePageClient />);

      await waitFor(() => expect(latest().autoAccept).toBe(true));
      expect(sessionStorage.getItem(AUTO_ACCEPT_KEY)).toBeNull();
    });

    it("leaves the auto-accept flag in place when the return has no live session", async () => {
      sessionStorage.setItem(AUTO_ACCEPT_KEY, "1");
      render(<InvitePageClient />);

      await waitFor(() => expect(oidc.built.length).toBeGreaterThan(0));
      expect(latest().autoAccept).toBe(false);
      expect(sessionStorage.getItem(AUTO_ACCEPT_KEY)).toBe("1");
    });

    it("stores the way back and the auto-accept flag, then redirects to sign in", () => {
      render(<InvitePageClient />);
      latest().onAuthRequired();

      expect(sessionStorage.getItem(REDIRECT_PATH_KEY)).toBe(
        window.location.pathname,
      );
      expect(sessionStorage.getItem(AUTO_ACCEPT_KEY)).toBe("1");
      expect(oidc.signinRedirect).toHaveBeenCalledTimes(1);
    });
  });

  it.each([
    [{ metadata: { org: "acme" } }, "/acme"],
    [{ metadata: {} }, "/"],
    [{}, "/"],
  ])("lands an accepted invitation %o on %s", (invitation, target) => {
    render(<InvitePageClient />);
    latest().onAccepted(invitation);
    expect(nav.push).toHaveBeenCalledWith(target);
  });
});
