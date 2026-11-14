import { test, expect } from "@playwright/test";
import { OIDC_HELP, OIDC_STACK } from "../../fixtures/oidc";

/**
 * CON-13 on a self-hosted server whose operator names where to ask for help
 * (STIGMER_HELP_URL and STIGMER_HELP_LABEL, set by global-setup in the OIDC
 * posture): the sign-in page offers it under its button before anyone signs
 * in, and the sidebar's foot offers it once signed in, each opening the
 * operator's address in a new tab. The trusted-local stack, which sets none,
 * shows none (tests/functional/help-link.spec.ts).
 *
 * Stack shape: `STIGMER_E2E_OIDC=1`; without it the arms SKIP with the reason.
 */
test.describe("CON-13 the operator's help link on a self-hosted server", () => {
  test.skip(!OIDC_STACK, "needs the OIDC stack shape — run with STIGMER_E2E_OIDC=1");

  test("is under Sign in on the sign-in page, and at the sidebar's foot once signed in", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
    const atSignIn = page.getByRole("link", { name: OIDC_HELP.label, exact: true });
    await expect(atSignIn).toHaveAttribute("href", OIDC_HELP.url);
    await expect(atSignIn).toHaveAttribute("target", "_blank");
    await expect(page.getByText(`Stuck? ${OIDC_HELP.label}`)).toBeVisible();

    // The issuer auto-consents: the guard's round trip lands signed in.
    await page.goto("/");
    const sidebar = page.getByRole("navigation", { name: "Main navigation" });
    await expect(sidebar).toBeVisible({ timeout: 15_000 });
    const atFoot = sidebar.getByRole("link", { name: OIDC_HELP.label, exact: true });
    await expect(atFoot).toHaveAttribute("href", OIDC_HELP.url);
  });
});
