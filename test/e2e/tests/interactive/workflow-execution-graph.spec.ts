import { test, expect } from "../../fixtures";
import { createTestWorkflowExecution } from "../../fixtures/seed-helpers";
import {
  navigateToExecution,
  waitForPhaseBadge,
} from "../../helpers/workflow-execution";
import { assertNoErrorBoundary } from "../../helpers/navigation";

test.describe("Workflow execution graph (T04)", () => {
  test("execution page renders the workflow graph canvas", async ({
    page,
    stigmerClient,
    testWorkflow,
  }) => {
    const execution = await createTestWorkflowExecution(
      stigmerClient,
      testWorkflow.id,
    );

    try {
      await navigateToExecution(page, execution.id);
      await assertNoErrorBoundary(page);

      await waitForPhaseBadge(page, "Completed", { timeout: 30_000 });

      const reactFlowCanvas = page.locator(".react-flow");
      await expect(reactFlowCanvas).toBeVisible({ timeout: 10_000 });
    } finally {
      await execution.cleanup();
    }
  });

  test("completed nodes show success execution status", async ({
    page,
    stigmerClient,
    testWorkflow,
  }) => {
    const execution = await createTestWorkflowExecution(
      stigmerClient,
      testWorkflow.id,
    );

    try {
      await navigateToExecution(page, execution.id);
      await assertNoErrorBoundary(page);

      await waitForPhaseBadge(page, "Completed", { timeout: 30_000 });

      const completedNodes = page.locator('[data-execution-status="completed"]');
      await expect(completedNodes.first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await execution.cleanup();
    }
  });

  test("graph is read-only by default (nodes are not draggable)", async ({
    page,
    stigmerClient,
    testWorkflow,
  }) => {
    const execution = await createTestWorkflowExecution(
      stigmerClient,
      testWorkflow.id,
    );

    try {
      await navigateToExecution(page, execution.id);
      await assertNoErrorBoundary(page);

      await waitForPhaseBadge(page, "Completed", { timeout: 30_000 });

      const reactFlowCanvas = page.locator(".react-flow");
      await expect(reactFlowCanvas).toBeVisible({ timeout: 10_000 });

      const firstNode = page.locator('[data-execution-status]').first();
      await expect(firstNode).toBeVisible();

      const box = await firstNode.boundingBox();
      if (box) {
        await firstNode.hover();
        await page.mouse.down();
        await page.mouse.move(box.x + 100, box.y + 100);
        await page.mouse.up();

        const newBox = await firstNode.boundingBox();
        expect(newBox?.x).toBeCloseTo(box.x, 0);
        expect(newBox?.y).toBeCloseTo(box.y, 0);
      }
    } finally {
      await execution.cleanup();
    }
  });

  test("selecting a node shows task info in the inspector stub", async ({
    page,
    stigmerClient,
    testWorkflow,
  }) => {
    const execution = await createTestWorkflowExecution(
      stigmerClient,
      testWorkflow.id,
    );

    try {
      await navigateToExecution(page, execution.id);
      await assertNoErrorBoundary(page);

      await waitForPhaseBadge(page, "Completed", { timeout: 30_000 });

      const taskNode = page.locator('[data-execution-status="completed"]').first();
      await expect(taskNode).toBeVisible({ timeout: 10_000 });
      await taskNode.click();

      const inspectorPanel = page.locator("aside");
      await expect(inspectorPanel.locator("h3")).toBeVisible({ timeout: 5_000 });
    } finally {
      await execution.cleanup();
    }
  });

  test("zoom controls are present", async ({
    page,
    stigmerClient,
    testWorkflow,
  }) => {
    const execution = await createTestWorkflowExecution(
      stigmerClient,
      testWorkflow.id,
    );

    try {
      await navigateToExecution(page, execution.id);
      await assertNoErrorBoundary(page);

      await waitForPhaseBadge(page, "Completed", { timeout: 30_000 });

      const controls = page.locator(".react-flow__controls");
      await expect(controls).toBeVisible({ timeout: 10_000 });
    } finally {
      await execution.cleanup();
    }
  });

  test("collapsible timeline panel shows event count", async ({
    page,
    stigmerClient,
    testWorkflow,
  }) => {
    const execution = await createTestWorkflowExecution(
      stigmerClient,
      testWorkflow.id,
    );

    try {
      await navigateToExecution(page, execution.id);
      await assertNoErrorBoundary(page);

      await waitForPhaseBadge(page, "Completed", { timeout: 30_000 });

      const timelineToggle = page.locator("button", { hasText: "Event Timeline" });
      await expect(timelineToggle).toBeVisible({ timeout: 10_000 });
      await expect(timelineToggle).toContainText("events");
    } finally {
      await execution.cleanup();
    }
  });
});
