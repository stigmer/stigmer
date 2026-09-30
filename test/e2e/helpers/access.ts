import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Open a static resource detail page's "Manage access" dialog from its
 * kebab menu (agent, skill, MCP server, workflow). Every step is awaited:
 * a spec that reaches this helper has seeded a resource its caller owns,
 * so a missing menu or menu item is a failure, not a reason to skip.
 */
export async function openManageAccessFromKebab(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "More actions" }).first().click();
  await page.getByRole("menuitem", { name: "Manage access" }).click();
  const dialog = page.getByRole("dialog", { name: "Manage access" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The detail header's visibility badge, which names the level and opens the dialog. */
export function visibilityBadge(page: Page): Locator {
  return page.getByRole("button", { name: /visibility — manage access$/ });
}
