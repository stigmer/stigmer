import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Navigate to a workflow detail page via library pushState URL.
 * Waits for the detail tabs to render (confirms the page has loaded data).
 */
export async function navigateToWorkflowDetail(
  page: Page,
  org: string,
  slug: string,
): Promise<void> {
  await page.goto(`/library/workflows/${org}/${slug}`);
  await page.getByRole("tablist", { name: "Workflow detail tabs" }).waitFor({
    state: "visible",
    timeout: 15_000,
  });
}

/**
 * Click the Run button in the detail action bar and wait for the dialog.
 * Assumes the page is already on a workflow detail view with a loaded workflow.
 */
export async function openRunDialog(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Run" }).click();
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
}

/**
 * Fill fields in the Run dialog. Only fills trigger message for test workflows
 * (which have no required env vars).
 */
export async function fillRunDialog(
  page: Page,
  opts?: { triggerMessage?: string },
): Promise<void> {
  if (opts?.triggerMessage) {
    await page.getByLabel("Input Message").fill(opts.triggerMessage);
  }
}

/**
 * Submit the Run dialog and wait for navigation to the execution page.
 * The console calls `router.push(/executions/${id})` on success —
 * this is a full Next.js navigation (page remount), not pushState.
 */
export async function submitRunAndWaitForExecution(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Run Workflow" }).click();
  await page.waitForURL(/\/executions\/wex_/, { timeout: 15_000 });
}
