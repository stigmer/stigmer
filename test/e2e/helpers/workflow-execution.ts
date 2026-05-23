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

export async function clickPause(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Pause" }).click();
}

export async function clickResume(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Resume" }).click();
}

export async function clickCancel(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Cancel" }).click();
}

/**
 * Wait for the execution phase badge to show a specific phase.
 * Uses Playwright's auto-retry mechanism via expect().toBeVisible().
 */
export async function waitForPhaseTransition(
  page: Page,
  targetPhase: WorkflowPhase,
  opts?: { timeout?: number },
): Promise<void> {
  await expect(page.getByRole("status", { name: targetPhase })).toBeVisible({
    timeout: opts?.timeout ?? 15_000,
  });
}

export function getExecutionInspector(page: Page): Locator {
  return page.locator("aside");
}

export async function selectExecutionNode(
  page: Page,
  opts?: { timeout?: number },
): Promise<void> {
  const node = page.locator('[data-execution-status]').first();
  await expect(node).toBeVisible({ timeout: opts?.timeout ?? 10_000 });
  await node.click();
}

export function getInspectorTabList(page: Page): Locator {
  return page.getByRole("tablist", { name: "Task execution details" });
}

export function getInspectorTab(page: Page, name: string): Locator {
  return page.getByRole("tab", { name });
}

export function getInspectorTabPanel(page: Page): Locator {
  return page.getByRole("tabpanel");
}
