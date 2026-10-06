import { test, expect } from "../../fixtures";
import {
  createTestWaitWorkflow,
  createTestWorkflowRun,
} from "../../fixtures/seed-helpers";
import {
  awaitWorkflowRunCompleted,
  navigateToRun,
  waitForPhaseBadge,
} from "../../helpers/workflow-run";
import { assertNoErrorBoundary } from "../../helpers/navigation";

test.describe("Workflow execution comparison", () => {
  test("Compare button is visible on terminal (completed) execution", async ({
    page,
    stigmerClient,
    testWorkflow,
  }) => {
    const execution = await createTestWorkflowRun(
      stigmerClient,
      testWorkflow.id,
    );

    try {
      await navigateToRun(page, execution.id);
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
  }) => {
    // A bespoke wait workflow (not the shared testWaitWorkflow fixture): the
    // running-window clock starts at API create, BEFORE navigation, and a
    // cold dev-server compile of the run route can exceed the
    // fixture's 10s default — the run would complete before the
    // header renders. 30s matches this spec's sibling tolerances.
    const waitWorkflow = await createTestWaitWorkflow(stigmerClient, {
      waitDurationSeconds: 30,
    });
    const execution = await createTestWorkflowRun(
      stigmerClient,
      waitWorkflow.id,
    );

    try {
      await navigateToRun(page, execution.id);
      await assertNoErrorBoundary(page);

      // Anchor on the non-terminal badge first so the hidden-assertion
      // below cannot pass vacuously on an unrendered header.
      await waitForPhaseBadge(page, "Running", { timeout: 15_000 });

      const compareButton = page.getByRole("button", { name: /Compare with/ });
      await expect(compareButton).toBeHidden();
    } finally {
      await execution.cleanup();
      await waitWorkflow.cleanup();
    }
  });

  test("Picker opens and shows recent executions", async ({
    page,
    stigmerClient,
    testWorkflow,
  }) => {
    const exec1 = await createTestWorkflowRun(
      stigmerClient,
      testWorkflow.id,
    );
    const exec2 = await createTestWorkflowRun(
      stigmerClient,
      testWorkflow.id,
    );

    try {
      // The picker offers only finished runs, and exec2's page shows only
      // exec2's phase: wait for exec1 on the server first (#1552).
      await awaitWorkflowRunCompleted(stigmerClient, exec1.id);
      await navigateToRun(page, exec2.id);
      await assertNoErrorBoundary(page);
      await waitForPhaseBadge(page, "Completed", { timeout: 30_000 });

      await page.getByRole("button", { name: /Compare with/ }).click();

      const dialog = page.getByRole("dialog", { name: "Select run to compare" });
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
    const exec1 = await createTestWorkflowRun(
      stigmerClient,
      testWorkflow.id,
    );
    const exec2 = await createTestWorkflowRun(
      stigmerClient,
      testWorkflow.id,
    );

    try {
      // The picker offers only finished runs, and exec2's page shows only
      // exec2's phase: wait for exec1 on the server first (#1552).
      await awaitWorkflowRunCompleted(stigmerClient, exec1.id);
      await navigateToRun(page, exec2.id);
      await assertNoErrorBoundary(page);
      await waitForPhaseBadge(page, "Completed", { timeout: 30_000 });

      await page.getByRole("button", { name: /Compare with/ }).click();
      const dialog = page.getByRole("dialog", { name: "Select run to compare" });
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      await dialog.getByRole("button", { name: "Compare" }).click();

      const comparisonSection = page.getByRole("region", { name: "Run comparison" });
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
    const exec1 = await createTestWorkflowRun(
      stigmerClient,
      testWorkflow.id,
    );
    const exec2 = await createTestWorkflowRun(
      stigmerClient,
      testWorkflow.id,
    );

    try {
      // The picker offers only finished runs, and exec2's page shows only
      // exec2's phase: wait for exec1 on the server first (#1552).
      await awaitWorkflowRunCompleted(stigmerClient, exec1.id);
      await navigateToRun(page, exec2.id);
      await assertNoErrorBoundary(page);
      await waitForPhaseBadge(page, "Completed", { timeout: 30_000 });

      await page.getByRole("button", { name: /Compare with/ }).click();
      const dialog = page.getByRole("dialog", { name: "Select run to compare" });
      await dialog.getByRole("button", { name: "Compare" }).click();

      const comparisonSection = page.getByRole("region", { name: "Run comparison" });
      await expect(comparisonSection).toBeVisible({ timeout: 10_000 });

      await page.getByRole("button", { name: "Back to run" }).click();

      await expect(comparisonSection).toBeHidden({ timeout: 5_000 });

      const compareButton = page.getByRole("button", { name: /Compare with/ });
      await expect(compareButton).toBeVisible();
    } finally {
      await exec1.cleanup();
      await exec2.cleanup();
    }
  });
});
