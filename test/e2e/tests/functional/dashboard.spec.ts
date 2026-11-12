import { test, expect } from "../../fixtures";

/**
 * The dashboard opens on its page heading for the active organization. An
 * organization where nothing has run yet is told what to do first instead
 * of being shown zeros: its first steps stand alone in the figures' place,
 * each a link into the console, and no counter or failures panel is drawn
 * (and no other organization's numbers either).
 */
test.describe("Dashboard", () => {
  test("renders the page heading and what the page is for", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("What your organization's agents did this week.")).toBeVisible();
  });

  test("an organization where nothing has run shows its first steps alone", async ({ page, freshOrg }) => {
    await page.goto("/dashboard");
    // The pin took: this is the fresh organization's dashboard.
    await expect(page.getByRole("button", { name: "Organization menu" })).toContainText(freshOrg.slug, {
      timeout: 15_000,
    });

    const summary = page.getByRole("region", { name: "Platform dashboard" });
    const steps = summary.getByRole("region", { name: "Get your organization running" });
    await expect(steps).toBeVisible({ timeout: 15_000 });
    await expect(steps.getByRole("link", { name: "Pick an example" })).toHaveAttribute("href", "/");
    await expect(steps.getByRole("link", { name: "Start a session" })).toHaveAttribute("href", "/");
    for (const counter of ["Active", "Completed", "Failed", "Tokens"]) {
      await expect(summary.getByText(counter, { exact: true })).toHaveCount(0);
    }
    await expect(summary.getByText("No recent failures")).toHaveCount(0);
    // Usage is tokens, never money: no price anywhere on the dashboard.
    await expect(summary).not.toContainText("$");
  });
});
