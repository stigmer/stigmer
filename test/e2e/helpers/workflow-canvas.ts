import type { Page, Locator } from "@playwright/test";

/**
 * Navigates to a workflow's visual editor canvas.
 *
 * 1. Goes to the workflow detail page
 * 2. Clicks the Editor tab
 * 3. Switches to Visual mode
 * 4. Waits for the React Flow canvas to render
 */
export async function navigateToVisualEditor(
  page: Page,
  org: string,
  slug: string,
): Promise<void> {
  await page.goto(`/library/workflows/${org}/${slug}`);
  await page
    .getByRole("tablist", { name: "Workflow detail tabs" })
    .waitFor({ timeout: 15_000 });

  await page.getByRole("tab", { name: "Editor" }).click();
  await page.waitForTimeout(1000);

  const visualTab = page.getByRole("tab", { name: "Visual" });
  if (await visualTab.isVisible()) {
    await visualTab.click();
  }

  await page.locator(".react-flow").waitFor({ timeout: 15_000 });
}

/**
 * Returns a locator for a canvas task node by task name.
 *
 * Uses the ARIA label pattern set by WorkflowNode:
 * `"{DisplayName} node {taskName}, {shape} shape"`.
 */
export function getCanvasNode(page: Page, taskName: string): Locator {
  return page.locator(`[aria-label*="node ${taskName}"]`);
}

/**
 * Returns a locator for a canvas node by its `data-task-kind` attribute.
 */
export function getCanvasNodeByKind(page: Page, kindString: string): Locator {
  return page.locator(`[data-task-kind="${kindString}"]`);
}

/**
 * Reads the `data-visual-class` attribute from a canvas node identified
 * by task name.
 */
export async function getNodeVisualClass(
  page: Page,
  taskName: string,
): Promise<string | null> {
  const node = getCanvasNode(page, taskName);
  return node.getAttribute("data-visual-class");
}
