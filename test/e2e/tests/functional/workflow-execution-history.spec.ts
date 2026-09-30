import { test, expect } from "../../fixtures";
import type { Stigmer } from "@stigmer/sdk";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { createTestWorkflowExecution } from "../../fixtures/seed-helpers";
import { navigateToWorkflowDetail } from "../../helpers/workflow-detail";

/**
 * The Executions tab of a workflow detail page: the history table, the
 * health metrics strip, the phase filters, and a row that opens its
 * execution.
 *
 * Each case seeds its own workflow (`testWorkflow`, two `set_vars` tasks
 * that need no model) and runs one execution of it to completion on the
 * stack's real runner, so the tab has exactly one completed row to show.
 */

async function runToCompletion(client: Stigmer, executionId: string): Promise<void> {
  await expect
    .poll(
      async () => (await client.workflowExecution.get(executionId)).status?.phase,
      { timeout: 60_000, message: "the seeded execution completes" },
    )
    .toBe(ExecutionPhase.EXECUTION_COMPLETED);
}

test.describe("Workflow execution history", () => {
  test("a completed execution is listed in the history table with its columns", async ({
    page,
    stigmerClient,
    testWorkflow,
  }) => {
    const execution = await createTestWorkflowExecution(stigmerClient, testWorkflow.id, {
      org: testWorkflow.org,
    });
    try {
      await runToCompletion(stigmerClient, execution.id);
      await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);
      await page.getByRole("tab", { name: "Executions" }).click();

      const table = page.getByRole("table", { name: "Execution history" });
      await expect(table).toBeVisible({ timeout: 15_000 });
      for (const name of ["Name", "Status", "Duration"]) {
        await expect(table.getByRole("columnheader", { name })).toBeVisible();
      }
      const rows = table.locator("tbody tr");
      await expect(rows).toHaveCount(1);
      await expect(rows.first()).toContainText("Completed");
    } finally {
      await execution.cleanup();
    }
  });

  test("the health metrics strip renders once the workflow has a run", async ({
    page,
    stigmerClient,
    testWorkflow,
  }) => {
    const execution = await createTestWorkflowExecution(stigmerClient, testWorkflow.id, {
      org: testWorkflow.org,
    });
    try {
      await runToCompletion(stigmerClient, execution.id);
      await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);
      await page.getByRole("tab", { name: "Executions" }).click();

      await expect(page.getByLabel("Execution health metrics")).toBeVisible({ timeout: 15_000 });
    } finally {
      await execution.cleanup();
    }
  });

  test("the Failed filter hides the completed run, and clearing it brings the run back", async ({
    page,
    stigmerClient,
    testWorkflow,
  }) => {
    const execution = await createTestWorkflowExecution(stigmerClient, testWorkflow.id, {
      org: testWorkflow.org,
    });
    try {
      await runToCompletion(stigmerClient, execution.id);
      await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);
      await page.getByRole("tab", { name: "Executions" }).click();

      const filters = page.getByLabel("Execution filters");
      await expect(filters.getByRole("button", { name: /Completed/ })).toBeVisible({
        timeout: 15_000,
      });
      const failed = filters.getByRole("button", { name: /Failed/ });
      const rows = page.getByRole("table", { name: "Execution history" }).locator("tbody tr");
      await expect(rows).toHaveCount(1);

      await failed.click();
      await expect(failed).toHaveAttribute("aria-pressed", "true");
      await expect(rows.filter({ hasText: "Completed" })).toHaveCount(0);

      await failed.click();
      await expect(failed).toHaveAttribute("aria-pressed", "false");
      await expect(rows).toHaveCount(1);
    } finally {
      await execution.cleanup();
    }
  });

  test("clicking the run's row opens that execution", async ({
    page,
    stigmerClient,
    testWorkflow,
  }) => {
    const execution = await createTestWorkflowExecution(stigmerClient, testWorkflow.id, {
      org: testWorkflow.org,
    });
    try {
      await runToCompletion(stigmerClient, execution.id);
      await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);
      await page.getByRole("tab", { name: "Executions" }).click();

      await page
        .getByRole("table", { name: "Execution history" })
        .locator("tbody tr")
        .first()
        .click({ timeout: 15_000 });

      await expect(page).toHaveURL(new RegExp(execution.id));
    } finally {
      await execution.cleanup();
    }
  });
});
