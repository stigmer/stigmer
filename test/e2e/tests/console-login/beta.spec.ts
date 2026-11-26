import { test, expect } from "@playwright/test";
import { OIDC_STACK } from "../../fixtures/oidc";

/**
 * Stigmer says it is in Beta on a self-hosted server that signs people in:
 * the sign-in page says the line under its lead before anyone signs in, its
 * word linking the page that says what Beta means, and once signed in the
 * sidebar's top row carries the "Beta" mark. The trusted-local stack, where no
 * one signs in, shows the mark (tests/functional/beta.spec.ts).
 *
 * Stack shape: `STIGMER_E2E_OIDC=1`; without it the arms SKIP with the reason.
 */

const BETA_LINE = "Stigmer is in Beta: things may change, and your work is kept. Tell us what breaks.";
const BETA_URL = "https://stigmer.ai/docs/beta";

test.describe("Stigmer says it is in Beta on a server that signs people in", () => {
  test.skip(!OIDC_STACK, "needs the OIDC stack shape — run with STIGMER_E2E_OIDC=1");

  for (const width of [1440, 390]) {
    test(`says the line on the sign-in page, and carries the mark once signed in, at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width > 400 ? 900 : 844 });
      await page.goto("/login");
      await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
      await expect(page.getByText(BETA_LINE, { exact: true })).toBeVisible();
      const atSignIn = page.getByRole("link", { name: "Beta", exact: true });
      await expect(atSignIn).toHaveAttribute("href", BETA_URL);
      await expect(atSignIn).toHaveAttribute("target", "_blank");
      await testInfo.attach(`sign-in-beta-${width}`, { body: await page.screenshot(), contentType: "image/png" });

      // The issuer auto-consents: the guard's round trip lands signed in.
      await page.goto("/");
      if (width < 1024) await page.getByRole("button", { name: "Open sidebar" }).click({ timeout: 15_000 });
      const sidebar = page.getByRole("navigation", { name: "Main navigation" });
      const mark = sidebar.getByRole("link", { name: BETA_LINE, exact: true });
      await expect(mark).toBeVisible({ timeout: 15_000 });
      await expect(mark).toHaveAttribute("href", BETA_URL);
      await testInfo.attach(`sidebar-beta-signed-in-${width}`, { body: await page.screenshot(), contentType: "image/png" });
    });
  }
});
