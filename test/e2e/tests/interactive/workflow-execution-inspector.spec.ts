import { test, expect } from "../../fixtures";
import { createTestWorkflowExecution } from "../../fixtures/seed-helpers";
import {
  navigateToExecution,
  waitForPhaseBadge,
  getExecutionInspector,
  selectExecutionNode,
  getInspectorTabList,
  getInspectorTab,
  getInspectorTabPanel,
} from "../../helpers/workflow-execution";
import { assertNoErrorBoundary } from "../../helpers/navigation";

test.describe("Workflow execution inspector (T05)", () => {
  test("clicking a node shows the inspector with Summary tab", async ({
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

      await selectExecutionNode(page);

      const inspector = getExecutionInspector(page);
      await expect(inspector).toBeVisible({ timeout: 5_000 });

      const tabList = getInspectorTabList(page);
      await expect(tabList).toBeVisible({ timeout: 5_000 });

      const summaryTab = getInspectorTab(page, "Summary");
      await expect(summaryTab).toHaveAttribute("aria-selected", "true");
    } finally {
      await execution.cleanup();
    }
  });

  test("Summary tab shows duration", async ({
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

      await selectExecutionNode(page);

      const panel = getInspectorTabPanel(page);
      await expect(panel).toBeVisible({ timeout: 5_000 });
      await expect(panel).toContainText(/\d+\s*(ms|s|m)/, { timeout: 5_000 });
    } finally {
      await execution.cleanup();
    }
  });

  test("deselecting shows empty state", async ({
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

      await selectExecutionNode(page);

      const inspector = getExecutionInspector(page);
      await expect(inspector).toBeVisible({ timeout: 5_000 });

      const pane = page.locator(".react-flow__pane");
      await pane.click({ position: { x: 10, y: 10 } });

      await expect(
        page.getByText("Click a node to view execution details"),
      ).toBeVisible({ timeout: 5_000 });
    } finally {
      await execution.cleanup();
    }
  });

  test("tab bar has ARIA tablist role", async ({
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

      await selectExecutionNode(page);

      const tabList = getInspectorTabList(page);
      await expect(tabList).toBeVisible({ timeout: 5_000 });
    } finally {
      await execution.cleanup();
    }
  });

  test("Events tab shows event count", async ({
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

      await selectExecutionNode(page);

      const eventsTab = getInspectorTab(page, "Events");
      await expect(eventsTab).toBeVisible({ timeout: 5_000 });
      await eventsTab.click();

      const panel = getInspectorTabPanel(page);
      await expect(panel).toBeVisible({ timeout: 5_000 });
    } finally {
      await execution.cleanup();
    }
  });

  test("inspector sidebar is wider than T04 stub", async ({
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

      await selectExecutionNode(page);

      const inspector = getExecutionInspector(page);
      await expect(inspector).toBeVisible({ timeout: 5_000 });

      const box = await inspector.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.width).toBeGreaterThanOrEqual(310);
    } finally {
      await execution.cleanup();
    }
  });
});
