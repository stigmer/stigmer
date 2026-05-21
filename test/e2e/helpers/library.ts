import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

export async function navigateToAgents(page: Page): Promise<void> {
  await page.goto("/library/agents");
  await page.locator('[aria-label="Agent workbench"]').waitFor({
    state: "visible",
    timeout: 15_000,
  });
}

export async function navigateToWorkflows(page: Page): Promise<void> {
  await page.goto("/library/workflows");
  await page.locator('[aria-label="Workflow workbench"]').waitFor({
    state: "visible",
    timeout: 15_000,
  });
}

export function getResourceCardsList(page: Page): Locator {
  return page.getByRole("list", { name: "Resource cards" });
}

export async function verifyResourceInList(
  page: Page,
  resourceSlug: string,
): Promise<Locator> {
  const cardsList = getResourceCardsList(page);
  const card = cardsList.getByRole("listitem").filter({ hasText: resourceSlug });
  await expect(card).toBeVisible({ timeout: 10_000 });
  return card;
}

export async function clickResourceCard(
  page: Page,
  resourceSlug: string,
): Promise<void> {
  const card = await verifyResourceInList(page, resourceSlug);
  await card.click();
}

export async function searchInWorkbench(
  page: Page,
  query: string,
  searchLabel: string,
): Promise<void> {
  const searchInput = page.getByRole("textbox", { name: searchLabel });
  await searchInput.fill(query);
}
