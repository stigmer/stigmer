import { test, expect } from "../../fixtures";
import { createTestWorkflowExecution } from "../../fixtures/seed-helpers";
import {
  navigateToExecution,
  waitForPhaseBadge,
  getExecutionTimeline,
  verifyTimelineHasEvents,
} from "../../helpers/workflow-execution";
import { assertNoErrorBoundary } from "../../helpers/navigation";

test.describe("Workflow execution flow", () => {
  test("set_vars workflow executes and shows Completed phase in UI", async ({
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
    } finally {
      await execution.cleanup();
    }
  });

  test("execution timeline shows events after completion", async ({
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

      const timeline = getExecutionTimeline(page);
      await expect(timeline).toBeVisible();
      await verifyTimelineHasEvents(page, 1);
    } finally {
      await execution.cleanup();
    }
  });

  test("execution page renders task names from workflow", async ({
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

      await expect(page.getByText("step-one")).toBeVisible();
      await expect(page.getByText("step-two")).toBeVisible();
    } finally {
      await execution.cleanup();
    }
  });
});
