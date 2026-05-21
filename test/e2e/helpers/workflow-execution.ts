import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

export type WorkflowPhase =
  | "Pending"
  | "Running"
  | "Completed"
  | "Failed"
  | "Cancelled"
  | "Terminated"
  | "Paused";

export async function navigateToExecution(
  page: Page,
  executionId: string,
): Promise<void> {
  await page.goto(`/executions/${executionId}`);
  await page.getByRole("status").first().waitFor({
    state: "visible",
    timeout: 15_000,
  });
}

export async function waitForPhaseBadge(
  page: Page,
  phase: WorkflowPhase,
  opts?: { timeout?: number },
): Promise<void> {
  await expect(page.getByRole("status", { name: phase })).toBeVisible({
    timeout: opts?.timeout ?? 60_000,
  });
}

export function getExecutionTimeline(page: Page): Locator {
  return page.getByRole("list", { name: "Execution timeline" });
}

export async function verifyTimelineHasEvents(
  page: Page,
  minCount = 1,
  opts?: { timeout?: number },
): Promise<void> {
  const timeline = getExecutionTimeline(page);
  const items = timeline.getByRole("listitem");
  await expect(items.first()).toBeVisible({ timeout: opts?.timeout ?? 30_000 });

  if (minCount > 1) {
    await expect(items.nth(minCount - 1)).toBeVisible({
      timeout: opts?.timeout ?? 30_000,
    });
  }
}
