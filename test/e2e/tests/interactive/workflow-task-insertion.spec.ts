import type { Page, Locator } from "@playwright/test";
import { test, expect } from "../../fixtures";
import { assertNoErrorBoundary } from "../../helpers/navigation";
import {
  navigateToVisualEditor,
  getCanvasNode,
  getCanvasNodeByKind,
  getEditorCanvas,
} from "../../helpers/workflow-canvas";

/** The task picker popover (opened by every insertion affordance). */
function getTaskPicker(page: Page): Locator {
  return page.locator('[role="dialog"][aria-label="Select task type"]');
}

/**
 * Waits for the picker's items to load. The picker fetches the task-kind
 * registry — until it lands, the section list renders skeletons, so
 * section-header and option assertions must gate on real options.
 */
async function waitForPickerLoaded(page: Page): Promise<void> {
  await expect(
    getTaskPicker(page).locator('button[role="option"]').first(),
  ).toBeVisible({ timeout: 15_000 });
}

/**
 * Opens the add-after picker for a canvas node.
 *
 * The add-after affordance is labeled per node — `Add task after
 * {taskName}` (the old bare `title="Add task after"` is gone; the tooltip
 * moved into a Tooltip component). Each node renders a toolbar button and
 * a hover twin with the same label, so `.first()` disambiguates between
 * the pair — the exact-name scoping is what keeps it from ever matching
 * a DIFFERENT node's button.
 */
/**
 * Zooms the canvas out until `target` clears the minimap overlay
 * (bottom-right), which intercepts pointer events over anything under it.
 *
 * Wheel-zoom, not drag-pan, on purpose: a pan drag needs an EMPTY start
 * point (editor nodes are draggable — grabbing one moves it), and finding
 * one is layout-dependent guesswork. Wheel events need no hit-testing and
 * zoom the canvas regardless of what is under the cursor. Zooming toward
 * the upper-left pulls the whole graph away from the bottom-right corner.
 * No-op when the target is already clear.
 */
async function zoomClearOfMinimap(
  page: Page,
  canvas: Locator,
  target: Locator,
): Promise<void> {
  const pane = canvas.locator(".react-flow__pane");
  for (let attempt = 0; attempt < 5; attempt++) {
    const [targetBox, miniBox, paneBox] = await Promise.all([
      target.boundingBox(),
      canvas.locator(".react-flow__minimap").boundingBox(),
      pane.boundingBox(),
    ]);
    if (!targetBox || !miniBox || !paneBox) return;

    const cx = targetBox.x + targetBox.width / 2;
    const cy = targetBox.y + targetBox.height / 2;
    const clear = cx < miniBox.x - 16 || cy < miniBox.y - 16;
    if (clear) return;

    await page.mouse.move(
      paneBox.x + paneBox.width * 0.3,
      paneBox.y + paneBox.height * 0.25,
    );
    await page.mouse.wheel(0, 320);
    // Let the zoom transform apply before re-measuring.
    await page.waitForTimeout(200);
  }
}

async function openAddAfterPicker(page: Page, node: Locator): Promise<void> {
  await node.click();

  const label = await node.getAttribute("aria-label");
  const taskName = label?.match(/ node (\S+),/)?.[1];
  expect(taskName, `node aria-label should carry the task name: ${label}`).toBeTruthy();

  const addAfter = page
    .getByRole("button", { name: `Add task after ${taskName}` })
    .first();
  await expect(addAfter).toBeVisible({ timeout: 5_000 });
  await addAfter.click();

  await expect(getTaskPicker(page)).toBeVisible({ timeout: 5_000 });
  await waitForPickerLoaded(page);
}

test.describe("Workflow task insertion (T08)", () => {
  // Canvas interactions are geometry-sensitive: at the default 1280×720
  // viewport the editor canvas column is ~330px wide and the minimap
  // overlay covers most of its lower area, intercepting pointer events on
  // bottom-of-graph nodes. A desktop-sized viewport gives the canvas
  // realistic proportions (and matches how the editor is actually used).
  test.use({ viewport: { width: 1720, height: 1080 } });

  test("edge plus button opens picker with contextual header", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );
    await assertNoErrorBoundary(page);

    // The edge "+" renders in design mode only; scoped to the editor
    // canvas (the Overview tab's read-only canvas has no insert buttons).
    const edgePlusButton = getEditorCanvas(page).locator(
      'button[aria-label="Insert task here"]',
    );
    await expect(edgePlusButton.first()).toBeAttached({ timeout: 10_000 });

    // No hover: straight vertical edges are zero-width SVG groups, which
    // Playwright reports as invisible — hover can never succeed on them.
    // The plus buttons are mounted with opacity 0 until hovered, and an
    // opacity-0 element is clickable; clicking one opens the picker just
    // as a pointer hover-then-click would. nth(1) is a mid-graph edge's
    // button, clear of the toolbar (top) and minimap (bottom-right).
    await edgePlusButton.nth(1).click();

    const pickerDialog = getTaskPicker(page);
    await expect(pickerDialog).toBeVisible({ timeout: 5_000 });

    // Should show a header with "Insert between"
    const header = pickerDialog.locator("text=Insert between");
    await expect(header).toBeVisible();
  });

  test("picker shows Suggested section with context-appropriate kinds", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );
    await assertNoErrorBoundary(page);

    await openAddAfterPicker(page, getCanvasNode(page, "init_vars"));

    const suggestedLabel = getTaskPicker(page).locator("text=Suggested");
    await expect(suggestedLabel).toBeVisible();
  });

  test("recently used kinds appear after first insertion", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );
    await assertNoErrorBoundary(page);

    await openAddAfterPicker(page, getCanvasNode(page, "init_vars"));

    // Select a task kind (e.g., Transform)
    const transformOption = getTaskPicker(page).locator(
      'button[role="option"]',
      { hasText: "Transform" },
    );
    await transformOption.first().click();

    // Re-open the picker from the newly created node — the "Recent"
    // section should now show Transform.
    const newNode = getCanvasNodeByKind(page, "transform").first();
    await expect(newNode).toBeVisible({ timeout: 5_000 });
    await openAddAfterPicker(page, newNode);

    const recentLabel = getTaskPicker(page).locator("text=Recent");
    await expect(recentLabel).toBeVisible();
  });

  test("disabled entries show tooltip explaining why", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );
    await assertNoErrorBoundary(page);

    // This test verifies that disabled items have aria-disabled and title attributes.
    // The specific disabled state depends on graph topology.
    await openAddAfterPicker(page, getCanvasNode(page, "init_vars"));

    // Check that disabled items have the aria-disabled attribute
    const disabledItems = getTaskPicker(page).locator('[aria-disabled="true"]');
    const disabledCount = await disabledItems.count();

    // If there are disabled items, they should have a title with the reason
    if (disabledCount > 0) {
      const title = await disabledItems.first().getAttribute("title");
      expect(title).toBeTruthy();
      expect(title!.length).toBeGreaterThan(0);
    }
  });

  test("switch node shows Add case button on hover", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );
    await assertNoErrorBoundary(page);

    const switchNode = getCanvasNodeByKind(page, "switch_case").first();
    await expect(switchNode).toBeVisible({ timeout: 10_000 });
    await switchNode.hover();

    const addCaseButton = switchNode.locator('button[aria-label="Add case"]');
    await expect(addCaseButton).toBeVisible({ timeout: 3_000 });
  });

  test("fork node shows Add branch button on hover", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );
    await assertNoErrorBoundary(page);

    // The multi-kind fixture carries no fork task — skip honestly.
    const forkNode = getCanvasNodeByKind(page, "fork").first();
    if ((await forkNode.count()) === 0) {
      test.skip();
      return;
    }
    await forkNode.hover();

    const addBranchButton = forkNode.locator('button[aria-label="Add branch"]');
    await expect(addBranchButton).toBeVisible({ timeout: 3_000 });
  });

  test("append-after rewires end connection", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );
    await assertNoErrorBoundary(page);

    // Count edges before insertion (scoped: the Overview tabpanel mounts
    // a second canvas whose edges would inflate a page-wide count)
    const canvas = getEditorCanvas(page);
    const edgesBefore = await canvas.locator(".react-flow__edge").count();

    const endNode = canvas.locator('[data-id="__end__"]');
    await expect(endNode).toBeAttached({ timeout: 10_000 });

    // The last REAL task node — sentinels also carry [data-task-kind]
    // (and are non-selectable), so exclude the terminal pills. It sits
    // under the minimap after fit-view; zoom it clear before clicking.
    const nodeBeforeEnd = canvas
      .locator('[data-task-kind]:not([data-visual-class="terminal-pill"])')
      .last();
    await zoomClearOfMinimap(page, canvas, nodeBeforeEnd);
    await openAddAfterPicker(page, nodeBeforeEnd);

    // Select the first enabled task kind
    const firstOption = getTaskPicker(page)
      .locator('button[role="option"]:not([aria-disabled="true"])')
      .first();
    await expect(firstOption).toBeVisible();
    await firstOption.click();

    // Splice creates 2 new edges and removes 1 → strictly more edges.
    await expect
      .poll(async () => canvas.locator(".react-flow__edge").count())
      .toBeGreaterThan(edgesBefore);
  });

  test("keyboard N opens contextual picker", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );
    await assertNoErrorBoundary(page);

    // Select a node first
    const node = getCanvasNode(page, "init_vars");
    await node.click();

    // Press N to open picker
    await page.keyboard.press("n");

    await expect(getTaskPicker(page)).toBeVisible({ timeout: 5_000 });
  });

  test("search filtering works across all sections", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );
    await assertNoErrorBoundary(page);

    await openAddAfterPicker(page, getCanvasNode(page, "init_vars"));

    // Type a search query
    const searchInput = getTaskPicker(page).locator(
      'input[aria-label="Search task types"]',
    );
    await searchInput.fill("agent");

    // Should show filtered results containing "agent"
    const options = getTaskPicker(page).locator('button[role="option"]');
    const count = await options.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const text = await options.nth(i).textContent();
      expect(text?.toLowerCase()).toContain("agent");
    }
  });
});
