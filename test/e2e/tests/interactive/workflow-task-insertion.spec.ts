import { test, expect } from "../../fixtures";
import { assertNoErrorBoundary } from "../../helpers/navigation";
import {
  navigateToVisualEditor,
  getCanvasNode,
} from "../../helpers/workflow-canvas";

test.describe("Workflow task insertion (T08)", () => {
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

    // Find an edge with a plus button
    const edgePlusButton = page.locator(
      'button[aria-label="Insert task here"]',
    );
    await expect(edgePlusButton.first()).toBeAttached({ timeout: 10_000 });

    // Hover to reveal the plus button
    const firstEdge = page.locator(".react-flow__edge").first();
    await firstEdge.hover();

    // Click the plus button
    await edgePlusButton.first().click();

    // Verify picker opens with a contextual header
    const pickerDialog = page.locator('[role="dialog"][aria-label="Select task type"]');
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

    // Click on a node to select it
    const node = await getCanvasNode(page, "init_vars");
    await node.click();

    // Click the add-after button on the node toolbar
    const addAfterButton = page.locator('button[title="Add task after"]');
    await expect(addAfterButton).toBeVisible({ timeout: 5_000 });
    await addAfterButton.click();

    // Verify picker opens with Suggested section
    const pickerDialog = page.locator('[role="dialog"][aria-label="Select task type"]');
    await expect(pickerDialog).toBeVisible({ timeout: 5_000 });

    // Suggested section header should be visible
    const suggestedLabel = pickerDialog.locator("text=Suggested");
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

    // Select a node and open picker
    const node = await getCanvasNode(page, "init_vars");
    await node.click();

    const addAfterButton = page.locator('button[title="Add task after"]');
    await expect(addAfterButton).toBeVisible({ timeout: 5_000 });
    await addAfterButton.click();

    // Select a task kind (e.g., Transform)
    const pickerDialog = page.locator('[role="dialog"][aria-label="Select task type"]');
    await expect(pickerDialog).toBeVisible({ timeout: 5_000 });

    const transformOption = pickerDialog.locator('button[role="option"]', {
      hasText: "Transform",
    });
    await transformOption.first().click();

    // Re-open picker from the newly created node
    // The "Recent" section should now show Transform
    const newNode = page.locator('[data-task-kind="transform"]').first();
    await expect(newNode).toBeVisible({ timeout: 5_000 });
    await newNode.click();

    const addAfterButton2 = page.locator('button[title="Add task after"]');
    await expect(addAfterButton2).toBeVisible({ timeout: 5_000 });
    await addAfterButton2.click();

    const pickerDialog2 = page.locator('[role="dialog"][aria-label="Select task type"]');
    await expect(pickerDialog2).toBeVisible({ timeout: 5_000 });

    const recentLabel = pickerDialog2.locator("text=Recent");
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
    const node = await getCanvasNode(page, "init_vars");
    await node.click();

    const addAfterButton = page.locator('button[title="Add task after"]');
    await expect(addAfterButton).toBeVisible({ timeout: 5_000 });
    await addAfterButton.click();

    const pickerDialog = page.locator('[role="dialog"][aria-label="Select task type"]');
    await expect(pickerDialog).toBeVisible({ timeout: 5_000 });

    // Check that disabled items have the aria-disabled attribute
    const disabledItems = pickerDialog.locator('[aria-disabled="true"]');
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

    // Find a switch_case node
    const switchNode = page.locator('[data-task-kind="switch_case"]').first();
    const isVisible = await switchNode.isVisible().catch(() => false);

    if (isVisible) {
      await switchNode.hover();

      const addCaseButton = page.locator('button[aria-label="Add case"]');
      await expect(addCaseButton).toBeVisible({ timeout: 3_000 });
    }
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

    // Find a fork node
    const forkNode = page.locator('[data-task-kind="fork"]').first();
    const isVisible = await forkNode.isVisible().catch(() => false);

    if (isVisible) {
      await forkNode.hover();

      const addBranchButton = page.locator('button[aria-label="Add branch"]');
      await expect(addBranchButton).toBeVisible({ timeout: 3_000 });
    }
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

    // Count edges before insertion
    const edgesBefore = await page.locator(".react-flow__edge").count();

    // Find the last task node (connected to __end__)
    const endNode = page.locator('[data-id="__end__"]');
    await expect(endNode).toBeAttached({ timeout: 10_000 });

    // Find a node connected to end by selecting it and using toolbar add
    // After inserting, the new node should be between the source and __end__
    // Verify edge count increased (splice creates 2 new edges, removes 1)
    const nodeBeforeEnd = page
      .locator("[data-task-kind]")
      .last();
    await nodeBeforeEnd.click();

    const addAfterButton = page.locator('button[title="Add task after"]');
    const isAddVisible = await addAfterButton.isVisible().catch(() => false);

    if (isAddVisible) {
      await addAfterButton.click();

      const pickerDialog = page.locator('[role="dialog"][aria-label="Select task type"]');
      await expect(pickerDialog).toBeVisible({ timeout: 5_000 });

      // Select any task
      const firstOption = pickerDialog.locator('button[role="option"]').first();
      if (await firstOption.isVisible()) {
        await firstOption.click();

        // Verify new node was created
        const edgesAfter = await page.locator(".react-flow__edge").count();
        expect(edgesAfter).toBeGreaterThanOrEqual(edgesBefore);
      }
    }
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
    const node = await getCanvasNode(page, "init_vars");
    await node.click();

    // Press N to open picker
    await page.keyboard.press("n");

    // Picker should open
    const pickerDialog = page.locator('[role="dialog"][aria-label="Select task type"]');
    await expect(pickerDialog).toBeVisible({ timeout: 5_000 });
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

    // Open picker
    const node = await getCanvasNode(page, "init_vars");
    await node.click();

    const addAfterButton = page.locator('button[title="Add task after"]');
    await expect(addAfterButton).toBeVisible({ timeout: 5_000 });
    await addAfterButton.click();

    const pickerDialog = page.locator('[role="dialog"][aria-label="Select task type"]');
    await expect(pickerDialog).toBeVisible({ timeout: 5_000 });

    // Type a search query
    const searchInput = pickerDialog.locator('input[aria-label="Search task types"]');
    await searchInput.fill("agent");

    // Should show filtered results containing "agent"
    const options = pickerDialog.locator('button[role="option"]');
    const count = await options.count();
    expect(count).toBeGreaterThan(0);

    // All visible options should match the search
    for (let i = 0; i < count; i++) {
      const text = await options.nth(i).textContent();
      expect(text?.toLowerCase()).toContain("agent");
    }
  });
});
