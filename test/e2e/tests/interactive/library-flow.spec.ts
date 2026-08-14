import { test, expect } from "../../fixtures";
import {
  createTestAgent,
  ensureDefaultOrg,
} from "../../fixtures/seed-helpers";
import {
  navigateToAgents,
  verifyResourceInList,
  clickResourceCard,
  getResourceCardsList,
} from "../../helpers/library";
import { assertNoErrorBoundary } from "../../helpers/navigation";

test.describe("Library agent flow", () => {
  test("agent created via API appears in the library card grid", async ({
    page,
    testAgent,
  }) => {
    await navigateToAgents(page);
    await assertNoErrorBoundary(page);

    const card = await verifyResourceInList(page, testAgent.slug);
    await expect(card).toContainText(testAgent.slug);
  });

  test("clicking an agent card opens the detail overlay", async ({
    page,
    testAgent,
  }) => {
    await navigateToAgents(page);
    await assertNoErrorBoundary(page);

    await clickResourceCard(page, testAgent.slug);

    await page.waitForURL(/\/library\/agents\/[^/]+\/[^/]+/, { timeout: 10_000 });
    await expect(page).toHaveURL(new RegExp(testAgent.slug));
    await assertNoErrorBoundary(page);
  });

  test("deleting an agent removes its card from the library", async ({
    page,
    stigmerClient,
  }) => {
    // Own agent, own lifecycle: the assertion is scoped to THIS card's
    // disappearance, so parallel workers' fixture agents sharing the list
    // can never affect the outcome (stigmer#744 — the old shape asserted
    // global emptiness the fixture model doesn't provide).
    await ensureDefaultOrg(stigmerClient);
    const agent = await createTestAgent(stigmerClient);
    try {
      await navigateToAgents(page);
      await assertNoErrorBoundary(page);
      await verifyResourceInList(page, agent.slug);

      await stigmerClient.agent.delete(agent.id);

      // Fresh load, then wait for a load-complete signal — either the card
      // grid (other agents exist) or the empty state — BEFORE asserting
      // absence, so an in-flight fetch can't produce a vacuous pass.
      await navigateToAgents(page);
      await assertNoErrorBoundary(page);
      await expect(
        getResourceCardsList(page).or(page.getByText("No agents yet")),
      ).toBeVisible({ timeout: 10_000 });
      await expect(
        getResourceCardsList(page)
          .getByRole("listitem")
          .filter({ hasText: agent.slug }),
      ).toHaveCount(0);
    } finally {
      // Idempotent if the in-test delete already succeeded.
      await agent.cleanup();
    }
  });
});
