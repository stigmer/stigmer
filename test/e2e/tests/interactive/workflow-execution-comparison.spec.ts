import { test, expect } from "../../fixtures";
import { createTestWorkflowExecution } from "../../fixtures/seed-helpers";
import {
  navigateToExecution,
  waitForPhaseBadge,
} from "../../helpers/workflow-execution";
import { assertNoErrorBoundary } from "../../helpers/navigation";

test.describe("Workflow execution comparison", () => {
  test("Compare button is visible on terminal (completed) execution", async ({
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

      const compareButton = page.getByRole("button", { name: /Compare with/ });
      await expect(compareButton).toBeVisible({ timeout: 5_000 });
    } finally {
      await execution.cleanup();
    }
  });

  test("Compare button is hidden on running execution", async ({
    page,
    stigmerClient,
    testWorkflow,
  }) => {
    const execution = await createTestWorkflowExecution(
      stigmerClient,
      testWorkflow.id,
      { waitForCompletion: false },
    );

    try {
      await navigateToExecution(page, execution.id);
      await assertNoErrorBoundary(page);

      const compareButton = page.getByRole("button", { name: /Compare with/ });
      await expect(compareButton).toBeHidden({ timeout: 5_000 });
    } finally {
      await execution.cleanup();
    }
  });

  test("Picker opens and shows recent executions", async ({
    page,
    stigmerClient,
    testWorkflow,
  }) => {
    const exec1 = await createTestWorkflowExecution(
      stigmerClient,
      testWorkflow.id,
    );
    const exec2 = await createTestWorkflowExecution(
      stigmerClient,
      testWorkflow.id,
    );

    try {
      await navigateToExecution(page, exec2.id);
      await assertNoErrorBoundary(page);
      await waitForPhaseBadge(page, "Completed", { timeout: 30_000 });

      await page.getByRole("button", { name: /Compare with/ }).click();

      const dialog = page.getByRole("dialog", { name: "Select execution to compare" });
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      const options = dialog.getByRole("option");
      await expect(options.first()).toBeVisible({ timeout: 5_000 });
    } finally {
      await exec1.cleanup();
      await exec2.cleanup();
    }
  });

  test("Comparison view shows summary cards and task table", async ({
    page,
    stigmerClient,
    testWorkflow,
  }) => {
    const exec1 = await createTestWorkflowExecution(
      stigmerClient,
      testWorkflow.id,
    );
    const exec2 = await createTestWorkflowExecution(
      stigmerClient,
      testWorkflow.id,
    );

    try {
      await navigateToExecution(page, exec2.id);
      await assertNoErrorBoundary(page);
      await waitForPhaseBadge(page, "Completed", { timeout: 30_000 });

      await page.getByRole("button", { name: /Compare with/ }).click();
      const dialog = page.getByRole("dialog", { name: "Select execution to compare" });
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      await dialog.getByRole("button", { name: "Compare" }).click();

      const comparisonSection = page.getByRole("region", { name: "Execution comparison" });
      await expect(comparisonSection).toBeVisible({ timeout: 10_000 });

      const summaryCards = page.getByLabel("Comparison summary");
      await expect(summaryCards).toBeVisible();

      const taskTable = page.getByLabel("Task comparison");
      await expect(taskTable).toBeVisible();
    } finally {
      await exec1.cleanup();
      await exec2.cleanup();
    }
  });

  test("Back button exits comparison mode", async ({
    page,
    stigmerClient,
    testWorkflow,
  }) => {
    const exec1 = await createTestWorkflowExecution(
      stigmerClient,
      testWorkflow.id,
    );
    const exec2 = await createTestWorkflowExecution(
      stigmerClient,
      testWorkflow.id,
    );

    try {
      await navigateToExecution(page, exec2.id);
      await assertNoErrorBoundary(page);
      await waitForPhaseBadge(page, "Completed", { timeout: 30_000 });

      await page.getByRole("button", { name: /Compare with/ }).click();
      const dialog = page.getByRole("dialog", { name: "Select execution to compare" });
      await dialog.getByRole("button", { name: "Compare" }).click();

      const comparisonSection = page.getByRole("region", { name: "Execution comparison" });
      await expect(comparisonSection).toBeVisible({ timeout: 10_000 });

      await page.getByRole("button", { name: "Back to execution" }).click();

      await expect(comparisonSection).toBeHidden({ timeout: 5_000 });

      const compareButton = page.getByRole("button", { name: /Compare with/ });
      await expect(compareButton).toBeVisible();
    } finally {
      await exec1.cleanup();
      await exec2.cleanup();
    }
  });
});
