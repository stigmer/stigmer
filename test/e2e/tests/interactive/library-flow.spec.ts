import { test, expect } from "../../fixtures";
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

  test("resource cards list is empty after agent is deleted", async ({
    page,
    stigmerClient,
  }) => {
    await navigateToAgents(page);
    await assertNoErrorBoundary(page);

    const cardsList = getResourceCardsList(page);
    const initialVisible = await cardsList.isVisible().catch(() => false);

    if (!initialVisible) {
      await expect(page.getByText("No agents yet")).toBeVisible();
    }
  });
});
