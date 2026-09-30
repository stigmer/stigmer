import { test, expect } from "../../fixtures";

/**
 * The workflow library list: its heading, search, view switcher and header
 * actions, the empty state of an organization with no workflow, and a
 * seeded workflow listed as a card that opens its detail page.
 *
 * The empty and seeded states each run in an organization of their own
 * (the `freshOrg` fixture), so neither depends on what other specs seeded.
 */
test.describe("Workflow list page", () => {
  test("renders heading, description, search and the view switcher", async ({ page }) => {
    await page.goto("/library/workflows");

    await expect(page.getByRole("heading", { name: "Workflows", level: 1 })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText("Browse and manage multi-step orchestration workflows."),
    ).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Search workflows…" })).toBeVisible();

    const views = page.getByRole("radiogroup", { name: "View mode" });
    await expect(views.getByRole("radio", { name: "Card view" })).toBeChecked();
    await expect(views.getByRole("radio", { name: "Table view" })).not.toBeChecked();
  });

  test("offers Create workflow and Apply YAML in the header", async ({ page }) => {
    await page.goto("/library/workflows");

    const header = page.getByLabel("Workflow workbench");
    await expect(header).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Apply YAML" })).toBeEnabled();
    await expect(page.getByRole("link", { name: "Create workflow" }).first()).toHaveAttribute(
      "href",
      "/library/workflows/new",
    );
  });

  test("an organization with no workflow shows the empty state with its own call to action", async ({
    page,
    freshOrg,
  }) => {
    await page.goto("/library/workflows");
    await expect(page.getByRole("button", { name: "Organization menu" })).toContainText(
      freshOrg.slug,
      { timeout: 15_000 },
    );

    const empty = page.getByRole("status").filter({ hasText: "No workflows yet" });
    await expect(empty).toBeVisible({ timeout: 15_000 });
    await expect(empty.getByRole("link", { name: "Create workflow" })).toHaveAttribute(
      "href",
      "/library/workflows/new",
    );
    await expect(page.getByRole("list", { name: "Resource cards" })).toHaveCount(0);
  });

  test("a seeded workflow is listed as a card and opens its detail page", async ({
    page,
    stigmerClient,
    freshOrg,
  }) => {
    const { createTestWorkflow } = await import("../../fixtures/seed-helpers");
    const workflow = await createTestWorkflow(stigmerClient, { org: freshOrg.slug });
    try {
      await page.goto("/library/workflows");

      const cards = page.getByRole("list", { name: "Resource cards" });
      await expect(cards.getByRole("listitem")).toHaveCount(1, { timeout: 15_000 });
      await cards.getByRole("listitem").filter({ hasText: workflow.slug }).click();

      await expect(page.getByRole("heading", { name: workflow.slug })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page).toHaveURL(new RegExp(`/library/workflows/${freshOrg.slug}/${workflow.slug}$`));
    } finally {
      await workflow.cleanup();
    }
  });
});
