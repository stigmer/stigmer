import { test, expect } from "@playwright/test";
import { OIDC_ISSUER, OIDC_STACK } from "../../fixtures/oidc";

/**
 * Console login against an authenticated self-hosted server
 * (20260913.02, sp.console-login; stigmer#924).
 *
 * The one flow this project exists to prove, end to end and hermetically:
 * a browser opens the console against a server booted in the OIDC posture
 * (`STIGMER_OIDC_ISSUER` / `_AUDIENCE` pointing at the harness's local
 * issuer, which auto-consents as its configured person), is sent to the
 * issuer, comes back through `/auth/callback` with a real PKCE code
 * exchange, carries the access token on its RPCs, is provisioned as an
 * identity account on first sign-in, reaches the create-organization form
 * with no dead wait, and signs out to the `/login` landing.
 *
 * Stack shape: `STIGMER_E2E_OIDC=1` (global-setup boots the issuer and the
 * server in the posture; `webServer.env` gives `next dev` the matching
 * `NEXT_PUBLIC_*`). Without it the arms SKIP with the reason — the trusted
 * local stack every other project runs against has no sign-in to prove.
 */

const API_PORT = process.env.STIGMER_E2E_API_PORT ?? "7234";

// The old org gate polled for a personal organization for 10 s before it
// showed the form (Q-CL-5). The form must appear well inside that.
const NO_DEAD_WAIT_MS = 8_000;

test.describe("console login against an authenticated self-hosted server", () => {
  test.skip(
    !OIDC_STACK,
    "needs the OIDC stack shape — run with STIGMER_E2E_OIDC=1",
  );

  test("signs in through the issuer, carries the bearer, is provisioned, reaches onboarding, and signs out to /login", async ({
    page,
  }) => {
    // Every RPC the console makes after sign-in must carry the bearer.
    const rpcAuthHeaders: Array<{
      path: string;
      authorization: string | undefined;
    }> = [];
    // The issuer answers /authorize with an instant 302, so its URL never
    // completes a page load; the browser's REQUEST to it is the evidence.
    const issuerRequests: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.origin === new URL(OIDC_ISSUER).origin) {
        issuerRequests.push(url.pathname);
      }
      if (url.port === API_PORT && request.method() === "POST") {
        rpcAuthHeaders.push({
          path: url.pathname,
          authorization: request.headers()["authorization"],
        });
      }
    });

    // 1. The guard sends an anonymous visitor to the issuer; the issuer
    //    auto-consents and returns through /auth/callback, where the
    //    console redeems the code at the issuer's /token.
    await page.goto("/");
    await page.waitForURL((url) => url.pathname === "/auth/callback", {
      timeout: 15_000,
    });
    expect(issuerRequests).toContain("/authorize");
    await expect
      .poll(() => issuerRequests.includes("/token"), { timeout: 15_000 })
      .toBe(true);

    // 2. The identity gate provisions the account and the org gate shows the
    //    onboarding form at once — no "Setting up your workspace" wait.
    await expect(
      page.getByRole("heading", { name: "Welcome to Stigmer" }),
    ).toBeVisible({
      timeout: NO_DEAD_WAIT_MS,
    });
    await expect(page.getByText("Setting up your workspace")).toHaveCount(0);

    // 3. The RPCs carried the bearer, and the first-sign-in pair ran.
    const paths = rpcAuthHeaders.map((entry) => entry.path);
    expect(paths.some((p) => p.endsWith("/whoAmI"))).toBe(true);
    expect(paths.some((p) => p.endsWith("/provisionMyAccount"))).toBe(true);
    for (const entry of rpcAuthHeaders) {
      if (entry.path.endsWith("/getServerInfo")) continue; // is_public: reachable tokenless
      expect(entry.authorization, `${entry.path} carries the bearer`).toMatch(
        /^Bearer .+/,
      );
    }

    // 4. Sign out lands on /login, showing the sign-in card, and does not
    //    bounce straight back into the issuer.
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL((url) => url.pathname === "/login", {
      timeout: 15_000,
    });
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await page.waitForTimeout(1_500);
    expect(new URL(page.url()).pathname).toBe("/login");
  });
});
