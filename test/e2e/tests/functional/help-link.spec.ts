import { test, expect } from "@playwright/test";

/**
 * CON-13 on a server whose operator names no help link (the trusted-local
 * stack sets neither STIGMER_HELP_URL nor STIGMER_HELP_LABEL): the console
 * shows none, at the sidebar's foot or under a failure, rather than a guess.
 * The OIDC stack, whose operator sets one, shows it
 * (tests/console-login/help-link.spec.ts).
 */
test.describe("CON-13 a server that names no help link", () => {
  test("shows no help row at the sidebar's foot and no help line under a failure", async ({ page }) => {
    await page.goto("/");
    const sidebar = page.getByRole("navigation", { name: "Main navigation" });
    await expect(sidebar).toBeVisible({ timeout: 15_000 });
    await page.goto("/sessions/ses_000000000000000000000000");
    await expect(page.getByRole("heading", { name: "This session didn’t open" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/^Stuck\?/)).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: /help|ask/i })).toHaveCount(0);
  });
});
