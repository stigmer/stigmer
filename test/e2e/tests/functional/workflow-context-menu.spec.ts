import { test, expect } from "../../fixtures";
import { assertNoErrorBoundary } from "../../helpers/navigation";
import {
  navigateToVisualEditor,
  getCanvasNode,
} from "../../helpers/workflow-canvas";

test.describe("Workflow context menus and keyboard shortcuts (T11)", () => {
  // -------------------------------------------------------------------------
  // Node context menu
  // -------------------------------------------------------------------------

  test("right-click on node opens context menu with expected items", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );
    await assertNoErrorBoundary(page);

    const node = await getCanvasNode(page, "init_vars");
    await node.click({ button: "right" });

    const menu = page.locator('[role="menu"]');
    await expect(menu).toBeVisible({ timeout: 5_000 });

    await expect(menu.locator('text=Rename')).toBeVisible();
    await expect(menu.locator('text=Duplicate')).toBeVisible();
    await expect(menu.locator('text=Copy')).toBeVisible();
    await expect(menu.locator('text=Add task after')).toBeVisible();
    await expect(menu.locator('text=Disable / Bypass')).toBeVisible();
    await expect(menu.locator('text=Wrap in Try/Catch')).toBeVisible();
    await expect(menu.locator('text=View YAML')).toBeVisible();
    await expect(menu.locator('text=Delete')).toBeVisible();
  });

  test("'Delete' from node context menu removes the node", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );
    await assertNoErrorBoundary(page);

    const node = await getCanvasNode(page, "init_vars");
    await expect(node).toBeAttached({ timeout: 10_000 });

    await node.click({ button: "right" });
    const menu = page.locator('[role="menu"]');
    await expect(menu).toBeVisible({ timeout: 5_000 });

    await menu.locator('text=Delete').last().click();

    await expect(getCanvasNode(page, "init_vars")).not.toBeAttached({
      timeout: 5_000,
    });
  });

  test("'Duplicate' from context menu creates a copy", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );
    await assertNoErrorBoundary(page);

    const node = await getCanvasNode(page, "init_vars");
    await node.click({ button: "right" });

    const menu = page.locator('[role="menu"]');
    await menu.locator('text=Duplicate').click();

    const duplicated = page.locator('[data-task-kind="set_variables"]');
    const count = await duplicated.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("'Disable / Bypass' from context menu toggles disabled state", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );
    await assertNoErrorBoundary(page);

    const node = await getCanvasNode(page, "init_vars");
    await node.click({ button: "right" });

    const menu = page.locator('[role="menu"]');
    await menu.locator('text=Disable / Bypass').click();

    // After toggling disabled, the Modified indicator should appear
    const modifiedIndicator = page.locator('text=Modified');
    await expect(modifiedIndicator).toBeVisible({ timeout: 5_000 });
  });

  // -------------------------------------------------------------------------
  // Edge context menu
  // -------------------------------------------------------------------------

  test("right-click on edge shows edge menu items", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );
    await assertNoErrorBoundary(page);

    const edge = page.locator(".react-flow__edge").first();
    await edge.click({ button: "right" });

    const menu = page.locator('[role="menu"]');
    await expect(menu).toBeVisible({ timeout: 5_000 });
    await expect(menu.locator('text=Insert task')).toBeVisible();
    await expect(menu.locator('text=Delete connection')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Pane context menu
  // -------------------------------------------------------------------------

  test("right-click on pane shows pane menu with Add task, Paste, Select all, Auto-layout", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );
    await assertNoErrorBoundary(page);

    const canvas = page.locator(".react-flow__pane");
    await canvas.click({ button: "right" });

    const menu = page.locator('[role="menu"]');
    await expect(menu).toBeVisible({ timeout: 5_000 });
    await expect(menu.locator('text=Add task')).toBeVisible();
    await expect(menu.locator('text=Paste')).toBeVisible();
    await expect(menu.locator('text=Select all')).toBeVisible();
    await expect(menu.locator('text=Auto-layout')).toBeVisible();
    await expect(menu.locator('text=Zoom to fit')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // Keyboard shortcuts
  // -------------------------------------------------------------------------

  test("Delete key removes selected node", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );
    await assertNoErrorBoundary(page);

    const node = await getCanvasNode(page, "init_vars");
    await node.click();
    await page.keyboard.press("Delete");

    await expect(getCanvasNode(page, "init_vars")).not.toBeAttached({
      timeout: 5_000,
    });
  });

  test("Ctrl+Z undoes the last action", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );
    await assertNoErrorBoundary(page);

    const node = await getCanvasNode(page, "init_vars");
    await node.click();
    await page.keyboard.press("Delete");

    await expect(getCanvasNode(page, "init_vars")).not.toBeAttached({
      timeout: 5_000,
    });

    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${modifier}+z`);

    await expect(getCanvasNode(page, "init_vars")).toBeAttached({
      timeout: 5_000,
    });
  });

  test("Ctrl+D duplicates selected node", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );
    await assertNoErrorBoundary(page);

    const node = await getCanvasNode(page, "init_vars");
    await node.click();

    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${modifier}+d`);

    const setVarsNodes = page.locator('[data-task-kind="set_variables"]');
    const count = await setVarsNodes.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test("Ctrl+C then Ctrl+V creates a copy with new name", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );
    await assertNoErrorBoundary(page);

    const node = await getCanvasNode(page, "init_vars");
    await node.click();

    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${modifier}+c`);
    await page.keyboard.press(`${modifier}+v`);

    const setVarsNodes = page.locator('[data-task-kind="set_variables"]');
    const count = await setVarsNodes.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  // -------------------------------------------------------------------------
  // View YAML dialog
  // -------------------------------------------------------------------------

  test("'View YAML' from context menu opens dialog with task YAML", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );
    await assertNoErrorBoundary(page);

    const node = await getCanvasNode(page, "init_vars");
    await node.click({ button: "right" });

    const menu = page.locator('[role="menu"]');
    await menu.locator('text=View YAML').click();

    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.locator('text=init_vars')).toBeVisible();
    await expect(dialog.locator('text=set_variables')).toBeVisible();

    await dialog.locator('button[aria-label="Close"]').click();
    await expect(dialog).not.toBeVisible({ timeout: 3_000 });
  });
});
