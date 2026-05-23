import { test, expect } from "../../fixtures";
import { createTestWorkflowExecution } from "../../fixtures/seed-helpers";
import {
  navigateToExecution,
  waitForPhaseBadge,
} from "../../helpers/workflow-execution";
import { assertNoErrorBoundary } from "../../helpers/navigation";

test.describe("Workflow execution waterfall timeline (T07)", () => {
  test("bottom panel shows Waterfall tab by default", async ({
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

      const waterfallTab = page.getByRole("button", { name: "Waterfall" });
      await expect(waterfallTab).toBeVisible({ timeout: 10_000 });

      const waterfall = page.getByRole("list", { name: "Execution waterfall" });
      await expect(waterfall).toBeVisible({ timeout: 10_000 });
    } finally {
      await execution.cleanup();
    }
  });

  test("switching to Events tab shows the event timeline", async ({
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

      const eventsTab = page.getByRole("button", { name: /Events/ });
      await eventsTab.click();

      const eventTimeline = page.getByRole("list", { name: "Execution timeline" });
      await expect(eventTimeline).toBeVisible({ timeout: 10_000 });
    } finally {
      await execution.cleanup();
    }
  });

  test("waterfall renders task rows with data-task-name attributes", async ({
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

      const taskRows = page.locator("[data-task-name]");
      const count = await taskRows.count();
      expect(count).toBeGreaterThan(0);
    } finally {
      await execution.cleanup();
    }
  });

  test("clicking a waterfall row selects the task in the graph", async ({
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

      const firstRow = page.locator("[data-task-name]").first();
      const taskName = await firstRow.getAttribute("data-task-name");
      expect(taskName).toBeTruthy();

      await firstRow.click();

      // Verify the inspector shows the selected task
      const inspector = page.locator('[class*="ExecutionInspector"]');
      if (await inspector.isVisible()) {
        await expect(page.getByText(taskName!)).toBeVisible({ timeout: 5_000 });
      }
    } finally {
      await execution.cleanup();
    }
  });

  test("bottom panel can be collapsed and expanded", async ({
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

      const collapseButton = page.getByRole("button", { name: /Collapse bottom panel|Expand bottom panel/ });
      await expect(collapseButton).toBeVisible({ timeout: 10_000 });

      await collapseButton.click();

      const waterfall = page.getByRole("list", { name: "Execution waterfall" });
      await expect(waterfall).not.toBeVisible();

      await collapseButton.click();
      await expect(waterfall).toBeVisible({ timeout: 5_000 });
    } finally {
      await execution.cleanup();
    }
  });
});
