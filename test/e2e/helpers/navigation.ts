import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

export async function assertNoErrorBoundary(page: Page): Promise<void> {
  await expect(page.getByText("Something went wrong")).toHaveCount(0);
}

export async function waitForPageReady(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await assertNoErrorBoundary(page);
}

export function getSidebar(page: Page): Locator {
  return page.getByRole("navigation", { name: "Main navigation" });
}

export async function navigateViaSidebar(page: Page, linkName: string): Promise<void> {
  const sidebar = getSidebar(page);
  await sidebar.getByRole("link", { name: linkName }).click();
}
