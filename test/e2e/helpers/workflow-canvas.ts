import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Returns a locator for the visual editor's React Flow canvas.
 *
 * The workflow detail page mounts TWO React Flow canvases — a read-only
 * one in the Overview tabpanel and the editable one in the Editor
 * tabpanel — so a bare `.react-flow` locator is a strict-mode violation.
 * All canvas helpers must resolve inside this scope, otherwise they can
 * silently match the Overview canvas.
 */
export function getEditorCanvas(page: Page): Locator {
  return page
    .getByRole("tabpanel", { name: "Editor" })
    .locator(".react-flow");
}

/**
 * Returns a locator for the Overview tab's read-only React Flow canvas —
 * the OTHER canvas of the dual-canvas hazard `getEditorCanvas` documents.
 * Overview-tab specs must scope through this, not a bare `.react-flow`.
 */
export function getOverviewCanvas(page: Page): Locator {
  return page
    .getByRole("tabpanel", { name: "Overview" })
    .locator(".react-flow");
}

/**
 * Navigates to a workflow's visual editor canvas.
 *
 * 1. Goes to the workflow detail page
 * 2. Clicks the Editor tab
 * 3. Switches the editor from Code mode (the default) to Visual mode,
 *    accepting the one-time "YAML will be normalized" confirmation
 * 4. Waits for the editable React Flow canvas to render
 *
 * Code mode also renders a read-only graph PREVIEW inside the Editor
 * tabpanel, so `getEditorCanvas` resolving is NOT proof of Visual mode —
 * only the mode tab's `aria-selected` is. Skipping the confirmation was
 * the root cause of the oss#571 editor-lane cascade: every design-mode
 * affordance (insert buttons, selection, inspector tabs) exists only on
 * the Visual canvas.
 */
export async function navigateToVisualEditor(
  page: Page,
  org: string,
  slug: string,
): Promise<void> {
  await page.goto(`/library/workflows/${org}/${slug}`);
  // 30s: a cold Next dev server compiles the route on first hit, and
  // parallel workers can queue behind that compile.
  await page
    .getByRole("tablist", { name: "Workflow detail tabs" })
    .waitFor({ timeout: 30_000 });

  await page.getByRole("tab", { name: "Editor" }).click();
  await switchEditorToVisualMode(page);
  await getEditorCanvas(page).waitFor({ timeout: 15_000 });
}

/**
 * Opens the visual editor for a workflow detail URL captured earlier
 * (the functional lane discovers an arbitrary workflow's URL in a
 * beforeAll). Element-anchored waits only — `networkidle` never settles
 * on pages with live connections.
 */
export async function openVisualEditorAtUrl(
  page: Page,
  detailUrl: string,
): Promise<void> {
  await page.goto(detailUrl);
  // 30s: a cold Next dev server compiles the route on first hit, and
  // parallel workers can queue behind that compile.
  await page
    .getByRole("tablist", { name: "Workflow detail tabs" })
    .waitFor({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Editor" }).click();
  await switchEditorToVisualMode(page);
  await getEditorCanvas(page).waitFor({ timeout: 15_000 });
}

/**
 * Switches an already-open Editor tab from Code mode (the default) to
 * Visual mode, accepting the normalization confirmation. No-op when
 * Visual is already selected.
 */
export async function switchEditorToVisualMode(page: Page): Promise<void> {
  const modeTabs = page.getByRole("tablist", { name: "Editor mode" });
  await modeTabs.waitFor({ timeout: 15_000 });

  const visualTab = modeTabs.getByRole("tab", { name: "Visual" });
  if ((await visualTab.getAttribute("aria-selected")) !== "true") {
    await visualTab.click();
    // Valid YAML → the normalization warning banner; accept it. (Invalid
    // YAML skips the banner and surfaces a save error instead — seeded
    // fixtures are always valid, so Continue is expected here.)
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(visualTab).toHaveAttribute("aria-selected", "true");
  }
}

/**
 * Returns a locator for a canvas task node by task name.
 *
 * Uses the ARIA label pattern set by WorkflowNode:
 * `"{DisplayName} node {taskName}, {shape} shape"`.
 */
export function getCanvasNode(page: Page, taskName: string): Locator {
  return getEditorCanvas(page).locator(`[aria-label*="node ${taskName}"]`);
}

/**
 * Returns a locator for a canvas node by its `data-task-kind` attribute.
 */
export function getCanvasNodeByKind(page: Page, kindString: string): Locator {
  return getEditorCanvas(page).locator(`[data-task-kind="${kindString}"]`);
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
