import { test, expect } from "../../fixtures";
import { createTestAgent } from "../../fixtures/seed-helpers";

/**
 * The agent library's list: its heading, search and header action, and the
 * card view as the default presentation of what an organization holds. The
 * case seeds one agent into an organization of its own (`freshOrg`), so the
 * list it opens holds exactly that card.
 */
test.describe("Library consistency: agents", () => {
  test("the agent library lists a seeded agent as the only card, in the default card view", async ({
    page,
    stigmerClient,
    freshOrg,
  }) => {
    const seeded = await createTestAgent(stigmerClient, { org: freshOrg.slug });
    try {
      await page.goto("/library/agents");

      await expect(page.getByRole("heading", { level: 1, name: "Agents" })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByRole("textbox", { name: "Search agents…" })).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Create agent" }).first(),
      ).toHaveAttribute("href", "/library/agents/new");

      const views = page.getByRole("radiogroup", { name: "View mode" });
      await expect(views.getByRole("radio", { name: "Card view" })).toBeChecked();

      const cards = page.getByRole("list", { name: "Resource cards" }).getByRole("listitem");
      await expect(cards).toHaveCount(1, { timeout: 15_000 });
      await expect(cards).toContainText(seeded.slug);
      await expect(page.getByRole("table")).toHaveCount(0);
    } finally {
      await seeded.cleanup();
    }
  });
});
