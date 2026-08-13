import { test, expect } from "../../fixtures";
import { assertNoErrorBoundary } from "../../helpers/navigation";
import {
  navigateToVisualEditor,
  getCanvasNode,
  getCanvasNodeByKind,
  getEditorCanvas,
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

    // The registered kind string is `set_vars` (`set_variables` was this
    // spec's own drift); scoped to the editor canvas.
    await expect
      .poll(async () => getCanvasNodeByKind(page, "set_vars").count())
      .toBeGreaterThanOrEqual(2);
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

    // Toggling disabled dirties the editor. With a wired onSave (the
    // console always wires it) the dirty signal is the Save button
    // becoming enabled — the "Modified" pill renders only in save-less
    // embeddings.
    await expect(page.getByRole("button", { name: "Save" })).toBeEnabled({
      timeout: 5_000,
    });
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

    // Straight vertical edges are zero-width SVG groups — Playwright
    // treats them as invisible, so element-targeted pointer actions can
    // never succeed and coordinate guessing lands on neighbors. Dispatch
    // the contextmenu event on the edge element itself.
    const edge = getEditorCanvas(page).locator(".react-flow__edge").first();
    await expect(edge).toBeAttached({ timeout: 10_000 });
    await edge.dispatchEvent("contextmenu");

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

    // Paste only renders with clipboard content (pinned by the picker's
    // context-menu-logic unit tests) — copy a node first so the pane
    // menu shows its full action set.
    const node = getCanvasNode(page, "init_vars");
    await node.click();
    const modifier = process.platform === "darwin" ? "Meta" : "Control";
    await page.keyboard.press(`${modifier}+c`);

    // Right-click empty canvas: the top-right corner is clear of the
    // toolbar (top-center), the graph column (center), Controls
    // (bottom-left), and the minimap (bottom-right). Raw mouse click —
    // the pane spans the canvas and needs no actionability checks.
    const paneBox = await getEditorCanvas(page)
      .locator(".react-flow__pane")
      .boundingBox();
    expect(paneBox).not.toBeNull();
    await page.mouse.click(
      paneBox!.x + paneBox!.width - 40,
      paneBox!.y + 40,
      { button: "right" },
    );

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

  test("undo restores a deleted node", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    // Live-confirmed product bug: undo restores the MODEL (the inspector
    // rebinds to the deleted node, the history entry is consumed) but the
    // canvas node never re-renders — the assertion below is correct and
    // ready; un-fixme when the canvas derivation picks up restored nodes.
    test.fixme(true, "undo restores model but not the canvas node — stigmer/stigmer#588");

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

    // Undo via the toolbar button — the Cmd+Z shortcut is gated on focus
    // being INSIDE the canvas container (useGraphHistory), and React
    // Flow's drag handler prevents default on node mousedown, so pointer
    // interactions never move focus there. Keyboard undo after a
    // pointer-driven delete is therefore unreachable without tabbing —
    // a keyboard-a11y gap noted in the oss#571 wrap-up; the button is
    // the discoverable affordance either way.
    const undoButton = page.getByRole("button", { name: "Undo" });
    await expect(undoButton).toBeEnabled();
    await undoButton.click();

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

    await expect
      .poll(async () => getCanvasNodeByKind(page, "set_vars").count())
      .toBeGreaterThanOrEqual(2);
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

    await expect
      .poll(async () => getCanvasNodeByKind(page, "set_vars").count())
      .toBeGreaterThanOrEqual(2);
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
    // The name appears in both the dialog title and the YAML body.
    await expect(dialog.locator('text=init_vars').first()).toBeVisible();
    // `taskToYaml` serializes the registered kind string (`kind: set_vars`).
    await expect(dialog.locator('text=set_vars').first()).toBeVisible();

    await dialog.locator('button[aria-label="Close"]').click();
    await expect(dialog).not.toBeVisible({ timeout: 3_000 });
  });
});
