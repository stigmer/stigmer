// ---------------------------------------------------------------------------
// InvitePageClient — the public invite page finds the visitor's own session
//
// The invite page lives outside the authenticated chain, so it detects the
// session itself. The redemption states belong to @stigmer/react-sdk's
// InvitationRedemption; what this shell owns, and this suite pins, is:
//
//   - disabled auth: the visitor counts as signed in, with no token;
//   - OIDC: the UserManager is built for the configured issuer; an unexpired
//     user's token is what the page's client sends; an expired user is
//     signed out;
//   - the auto-accept flag written before the sign-in redirect is consumed
//     exactly once, on the return with a live session;
//   - "sign in to accept" stores the way back and the flag, and redirects
//     through the configured issuer;
//   - sign-up is offered (stigmer#3204) only once the issuer's sign-up
//     arguments answer with at least one, never before, never for an empty
//     answer or a failed read, never with sign-in off; it stores the same
//     way back and flag and redirects with those arguments;
//   - an accepted invitation makes the visitor's account first (a first-time
//     visitor has none yet), then remembers the organization joined as the
//     active one, leaves it for this tab's launcher to welcome them to
//     (stigmer#3208), and goes home, where the console restores it; a failed
//     account step still lands, since the console's gate retries it.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { Stigmer } from "@stigmer/client";
import type { AuthConfig } from "@/auth/types";
import type { OidcConfig } from "@/auth/oidc/types";

const REDIRECT_PATH_KEY = "stigmer:auth:redirect_path";
const AUTO_ACCEPT_KEY = "stigmer:invite:auto_accept";
const JOINED_ORG_KEY = "stigmer:invite:joined";

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

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const oidc = vi.hoisted(() => ({
  built: [] as OidcConfig[],
  user: null as FakeUser | null,
  signinRedirect: vi.fn(),
  // What the issuer's sign-up arguments answer: settled by each test.
  signupArgs: null as Promise<Record<string, unknown>> | null,
}));
vi.mock("@/auth/oidc/oidc-manager", () => ({
  createUserManager: (config: OidcConfig) => {
    oidc.built.push(config);
    return {
      getUser: async () => oidc.user,
      signinRedirect: oidc.signinRedirect,
    };
  },
  signupRedirectArgs: () => oidc.signupArgs ?? Promise.resolve({}),
}));

interface RedemptionProps {
  token: string;
  isAuthenticated: boolean;
  autoAccept: boolean;
  onAccepted: (invitation: { metadata?: { org?: string } }) => void;
  onAuthRequired: () => void;
  onSignUp?: () => void;
}

const page = vi.hoisted(() => ({
  redemption: [] as RedemptionProps[],
  clients: [] as Stigmer[],
  steps: [] as string[],
  ensure: { fails: false },
}));
vi.mock("@stigmer/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@stigmer/client")>()),
  ensureMyIdentityAccount: async (client: Stigmer) => {
    page.steps.push(
      client === page.clients.at(-1) ? "account:page-client" : "account:other",
    );
    if (page.ensure.fails) throw new Error("unavailable");
    return { account: {}, created: true };
  },
}));
vi.mock("@stigmer/react-sdk", () => ({
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
  rememberActiveOrg: (id: string) => {
    page.steps.push(`remember:${id}`);
  },
}));

// The frame draws the server's help line when the page asks for it; here it
// stands in, so the test holds that the page asks.
vi.mock("@stigmer/react-sdk/console", () => ({
  StandaloneScreen: ({ help, children }: { help?: boolean; children?: React.ReactNode }) => (
    <>
      {children}
      {help === true && <p>Stuck? Talk to us</p>}
    </>
  ),
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
    oidc.signupArgs = null;
    nav.push.mockReset();
    page.redemption = [];
    page.clients = [];
    page.steps = [];
    page.ensure.fails = false;
    nav.push.mockImplementation((path: string) => page.steps.push(`go:${path}`));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("CON-13 places the server's help line under the invitation", () => {
    render(<InvitePageClient />);
    expect(screen.getByText("Stuck? Talk to us")).toBeTruthy();
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

    it("offers no sign-up", async () => {
      render(<InvitePageClient />);
      await Promise.resolve();

      expect(latest().onSignUp).toBeUndefined();
    });
  });

  describe("OIDC", () => {
    beforeEach(() => {
      authConfig.value = { mode: "oidc", oidc: CONFIGURED };
    });

    it("starts signed out and builds the manager for the configured issuer", async () => {
      render(<InvitePageClient />);

      expect(latest().isAuthenticated).toBe(false);
      await waitFor(() => expect(oidc.built.length).toBeGreaterThan(0));
      expect(oidc.built.every((config) => config === CONFIGURED)).toBe(true);
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
      expect(oidc.signinRedirect.mock.calls[0]?.[0]).toBeUndefined();
    });

    describe("sign-up", () => {
      it("offers one sign-in until the issuer's sign-up arguments answer", async () => {
        const answer = deferred<Record<string, unknown>>();
        oidc.signupArgs = answer.promise;
        render(<InvitePageClient />);

        await waitFor(() => expect(oidc.built.length).toBeGreaterThan(0));
        expect(latest().onSignUp).toBeUndefined();

        answer.resolve({ prompt: "create" });
        await waitFor(() => expect(latest().onSignUp).toBeTypeOf("function"));
      });

      it("offers sign-up once the arguments answer, and redirects with them back to this invite", async () => {
        const args = { extraQueryParams: { audience: CONFIGURED.audience, screen_hint: "signup" } };
        oidc.signupArgs = Promise.resolve(args);
        render(<InvitePageClient />);

        await waitFor(() => expect(latest().onSignUp).toBeTypeOf("function"));
        latest().onSignUp?.();

        expect(sessionStorage.getItem(REDIRECT_PATH_KEY)).toBe(window.location.pathname);
        expect(sessionStorage.getItem(AUTO_ACCEPT_KEY)).toBe("1");
        expect(oidc.signinRedirect).toHaveBeenCalledTimes(1);
        expect(oidc.signinRedirect).toHaveBeenCalledWith(args);
      });

      it("offers no sign-up when the issuer has none (an empty answer)", async () => {
        const answer = deferred<Record<string, unknown>>();
        oidc.signupArgs = answer.promise;
        render(<InvitePageClient />);
        answer.resolve({});
        await answer.promise;
        await Promise.resolve();

        expect(latest().onSignUp).toBeUndefined();
      });

      it("offers no sign-up when the arguments cannot be read", async () => {
        const answer = deferred<Record<string, unknown>>();
        oidc.signupArgs = answer.promise;
        render(<InvitePageClient />);
        answer.reject(new Error("discovery unreachable"));
        await answer.promise.catch(() => undefined);
        await Promise.resolve();

        expect(latest().onSignUp).toBeUndefined();
      });
    });
  });

  it("CON-12 makes the account, remembers the organization joined, then goes home", async () => {
    render(<InvitePageClient />);
    latest().onAccepted({ metadata: { org: "org_acme" } });
    await waitFor(() => expect(page.steps).toHaveLength(3));
    expect(page.steps).toEqual([
      "account:page-client",
      "remember:org_acme",
      "go:/",
    ]);
  });

  it("leaves the organization joined for this tab's launcher before going home", async () => {
    let joinedAtNavigation: string | null = null;
    nav.push.mockImplementation((path: string) => {
      joinedAtNavigation = sessionStorage.getItem(JOINED_ORG_KEY);
      page.steps.push(`go:${path}`);
    });
    render(<InvitePageClient />);
    latest().onAccepted({ metadata: { org: "org_acme" } });
    await waitFor(() => expect(page.steps).toHaveLength(3));

    expect(joinedAtNavigation).toBe(JSON.stringify({ org: "org_acme" }));
  });

  it("still goes home when storage refuses the joined organization", async () => {
    render(<InvitePageClient />);
    // Storage is refused from here on, as on an origin that blocks it.
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("storage disabled", "QuotaExceededError");
      },
      removeItem: () => undefined,
    });
    latest().onAccepted({ metadata: { org: "org_acme" } });
    await waitFor(() => expect(page.steps).toHaveLength(3));
    expect(page.steps.slice(1)).toEqual(["remember:org_acme", "go:/"]);
  });

  it("still lands when the account step fails", async () => {
    page.ensure.fails = true;
    render(<InvitePageClient />);
    latest().onAccepted({ metadata: { org: "org_acme" } });
    await waitFor(() => expect(page.steps).toHaveLength(3));
    expect(page.steps.slice(1)).toEqual(["remember:org_acme", "go:/"]);
  });

  it("remembers nothing for an invitation naming no organization", async () => {
    render(<InvitePageClient />);
    latest().onAccepted({});
    await waitFor(() => expect(page.steps).toHaveLength(3));
    expect(page.steps.slice(1)).toEqual(["remember:", "go:/"]);
    expect(sessionStorage.getItem(JOINED_ORG_KEY)).toBeNull();
  });
});
