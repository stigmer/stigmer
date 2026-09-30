import { test, expect } from "../../fixtures";
import { createTestSkill } from "../../fixtures/seed-helpers";

/**
 * The skill library list: its heading, search, view switcher and header
 * actions, the empty state of an organization with no skill, and a seeded
 * skill listed as a card that opens its detail page.
 *
 * The empty and seeded states each run in an organization of their own
 * (the `freshOrg` fixture), so neither depends on what other specs seeded.
 */
test.describe("Skills list page", () => {
  test("renders heading, description, search and the view switcher", async ({ page }) => {
    await page.goto("/library/skills");

    await expect(page.getByRole("heading", { level: 1, name: "Skills" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Browse and manage skills in your organization.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Search skills…" })).toBeVisible();

    const views = page.getByRole("radiogroup", { name: "View mode" });
    await expect(views.getByRole("radio", { name: "Card view" })).toBeChecked();
    await expect(views.getByRole("radio", { name: "Table view" })).not.toBeChecked();
  });

  test("offers Upload skill in the header", async ({ page }) => {
    await page.goto("/library/skills");

    await expect(page.getByLabel("Skill workbench")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("link", { name: "Upload skill" }).first()).toHaveAttribute(
      "href",
      "/library/skills/new",
    );
  });

  test("an organization with no skill shows the empty state with its own call to action", async ({
    page,
    freshOrg,
  }) => {
    await page.goto("/library/skills");
    await expect(page.getByRole("button", { name: "Organization menu" })).toContainText(
      freshOrg.slug,
      { timeout: 15_000 },
    );

    const empty = page.getByRole("status").filter({ hasText: "No skills yet" });
    await expect(empty).toBeVisible({ timeout: 15_000 });
    await expect(empty.getByRole("link", { name: "Upload skill" })).toHaveAttribute(
      "href",
      "/library/skills/new",
    );
    await expect(page.getByRole("list", { name: "Resource cards" })).toHaveCount(0);
  });

  test("a seeded skill is listed as a card and opens its detail page", async ({
    page,
    stigmerClient,
    freshOrg,
  }) => {
    const skill = await createTestSkill(stigmerClient, { org: freshOrg.slug });
    try {
      await page.goto("/library/skills");

      const cards = page.getByRole("list", { name: "Resource cards" });
      await expect(cards.getByRole("listitem")).toHaveCount(1, { timeout: 15_000 });
      await cards.getByRole("listitem").filter({ hasText: skill.slug }).click();

      await expect(page.getByRole("heading", { name: skill.slug })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page).toHaveURL(new RegExp(`/library/skills/${freshOrg.slug}/${skill.slug}$`));
    } finally {
      await skill.cleanup();
    }
  });
});
