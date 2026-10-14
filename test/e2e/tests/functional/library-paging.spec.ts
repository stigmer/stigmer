import { test, expect } from "../../fixtures";
import { createTestAgent, type TestAgentResult } from "../../fixtures/seed-helpers";

/**
 * The agent library pages its list by token: a page holds 20 agents,
 * newest first, "Next page" follows the server's token to the older ones
 * and "Previous page" returns, and the pager says which page is shown
 * with no total ("Page 2", never "of N" or a result count). The case
 * seeds 21 agents into an organization of its own (`freshOrg`), so the
 * second page holds exactly the first one seeded.
 */
test.describe("Library paging: agents", () => {
  test("pages the agent list next and previous by token, with no total", async ({
    page,
    stigmerClient,
    freshOrg,
  }) => {
    test.setTimeout(120_000);
    const seeded: TestAgentResult[] = [];
    try {
      // Sequential, so creation order (and the list's newest-first order)
      // is the seeding order.
      for (let i = 1; i <= 21; i++) {
        seeded.push(
          await createTestAgent(stigmerClient, {
            org: freshOrg.slug,
            name: `paging-${String(i).padStart(2, "0")}-${Date.now()}`,
          }),
        );
      }
      const oldest = seeded[0]!;

      await page.goto("/library/agents");
      const cards = page.getByRole("list", { name: "Resource cards" }).getByRole("listitem");
      await expect(cards).toHaveCount(20, { timeout: 30_000 });
      await expect(page.getByText("Page 1", { exact: true })).toBeVisible();
      await expect(page.getByText(/\d+ results?$/)).toHaveCount(0);
      await expect(cards.filter({ hasText: oldest.slug })).toHaveCount(0);

      await page.getByRole("button", { name: "Next page" }).click();
      await expect(cards).toHaveCount(1, { timeout: 15_000 });
      await expect(cards).toContainText(oldest.slug);
      await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();

      await page.getByRole("button", { name: "Previous page" }).click();
      await expect(cards).toHaveCount(20, { timeout: 15_000 });
      await expect(page.getByText("Page 1", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Previous page" })).toBeDisabled();
    } finally {
      await Promise.all(seeded.map((agent) => agent.cleanup()));
    }
  });
});
