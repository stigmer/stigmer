import { test, expect } from "../../fixtures";

/**
 * The dashboard opens on its page heading for the active organization. An
 * organization where nothing has run yet is told what to do first instead
 * of being shown zeros: the journey's six steps, "From first agent to your
 * users", stand alone in the figures' place with a count of those done, the
 * current step's one act a link into the console, and no counter or
 * failures panel is drawn (and no other organization's numbers either).
 * "Hide" removes the card for this person in this organization, and it
 * stays hidden on reload.
 */
test.describe("Dashboard", () => {
  test("renders the page heading and what the page is for", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("What your organization's agents did this week.")).toBeVisible();
  });

  test("an organization where nothing has run shows the journey's six steps alone", async ({ page, freshOrg }) => {
    await page.goto("/dashboard");
    // The pin took: this is the fresh organization's dashboard.
    await expect(page.getByRole("button", { name: "Organization menu" })).toContainText(freshOrg.slug, {
      timeout: 15_000,
    });

    const summary = page.getByRole("region", { name: "Platform dashboard" });
    const card = summary.getByRole("region", { name: "From first agent to your users" });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByRole("listitem")).toHaveCount(6);
    await expect(card).toContainText(/\b[0-5] of 6\b/);
    // No agent yet: saying what it should do is the step to take, its one act.
    const current = card.locator('[aria-current="step"]');
    await expect(current).toContainText("Say what it should do");
    await expect(current.getByRole("link", { name: "Pick an example" })).toHaveAttribute("href", "/");
    await expect(card.getByRole("link")).toHaveCount(1);
    for (const counter of ["Active", "Completed", "Failed", "Tokens"]) {
      await expect(summary.getByText(counter, { exact: true })).toHaveCount(0);
    }
    await expect(summary.getByText("No recent failures")).toHaveCount(0);
    // Usage is tokens, never money: no price anywhere on the dashboard.
    await expect(summary).not.toContainText("$");
  });

  test("Hide removes the journey's card, and it stays hidden on reload", async ({ page, freshOrg }) => {
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Organization menu" })).toContainText(freshOrg.slug, {
      timeout: 15_000,
    });
    const summary = page.getByRole("region", { name: "Platform dashboard" });
    const card = summary.getByRole("region", { name: "From first agent to your users" });
    await expect(card).toBeVisible({ timeout: 15_000 });

    await card.getByRole("button", { name: "Hide these steps" }).click();
    await expect(card).toHaveCount(0);
    // The figures take its place: hidden is not "nothing to show".
    await expect(summary.getByText("Active", { exact: true })).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible({ timeout: 15_000 });
    await expect(summary.getByText("Active", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(card).toHaveCount(0);
  });
});
