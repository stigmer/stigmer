import { test, expect } from "../../fixtures";
import {
  navigateToWorkflowDetail,
  openRunDialog,
  fillRunDialog,
  submitRunAndWaitForExecution,
} from "../../helpers/workflow-detail";
import {
  waitForPhaseBadge,
  getExecutionTimeline,
  verifyTimelineHasEvents,
  clickPause,
  clickResume,
  clickCancel,
  waitForPhaseTransition,
} from "../../helpers/workflow-execution";
import { assertNoErrorBoundary } from "../../helpers/navigation";

test.describe("Workflow execution via Run button", () => {
  test("Run dialog opens from workflow detail page", async ({
    page,
    testWorkflow,
  }) => {
    await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);
    await assertNoErrorBoundary(page);

    await openRunDialog(page);

    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("heading", { name: new RegExp(`Run .+`) }),
    ).toBeVisible();
    // Trigger input is hidden for workflows that don't use $input;
    // the escape-hatch toggle should be present instead.
    await expect(
      dialog.getByRole("button", { name: "+ Add trigger input" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Run Workflow" }),
    ).toBeVisible();
  });

  test("submitting Run navigates to execution page", async ({
    page,
    testWorkflow,
  }) => {
    await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);
    await openRunDialog(page);
    await fillRunDialog(page, { triggerMessage: "e2e trigger" });
    await submitRunAndWaitForExecution(page);

    await assertNoErrorBoundary(page);
    await expect(page.getByRole("status").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("execution completes with timeline events", async ({
    page,
    testWorkflow,
  }) => {
    await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);
    await openRunDialog(page);
    await submitRunAndWaitForExecution(page);
    await assertNoErrorBoundary(page);

    await waitForPhaseBadge(page, "Completed", { timeout: 30_000 });

    const timeline = getExecutionTimeline(page);
    await expect(timeline).toBeVisible();
    await verifyTimelineHasEvents(page, 1);

    await expect(page.getByText("step_one")).toBeVisible();
  });

  test("pause a running execution then resume to completion", async ({
    page,
    testWaitWorkflow,
  }) => {
    await navigateToWorkflowDetail(
      page,
      testWaitWorkflow.org,
      testWaitWorkflow.slug,
    );
    await openRunDialog(page);
    await submitRunAndWaitForExecution(page);
    await assertNoErrorBoundary(page);

    await waitForPhaseBadge(page, "Running", { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

    await clickPause(page);
    await waitForPhaseTransition(page, "Paused", { timeout: 10_000 });
    await expect(page.getByRole("button", { name: "Resume" })).toBeVisible();

    await clickResume(page);

    // After resume, wait timer continues then set_vars runs → Completed
    await waitForPhaseBadge(page, "Completed", { timeout: 20_000 });
    await verifyTimelineHasEvents(page, 1);
  });

  test("running the same workflow twice creates two distinct executions", async ({
    page,
    testWorkflow,
  }) => {
    await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);

    await openRunDialog(page);
    await submitRunAndWaitForExecution(page);
    await assertNoErrorBoundary(page);

    const firstUrl = page.url();
    await waitForPhaseBadge(page, "Completed", { timeout: 30_000 });

    await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);

    await openRunDialog(page);
    await submitRunAndWaitForExecution(page);
    await assertNoErrorBoundary(page);

    const secondUrl = page.url();
    await waitForPhaseBadge(page, "Completed", { timeout: 30_000 });

    expect(firstUrl).not.toBe(secondUrl);
    expect(firstUrl).toMatch(/\/executions\/wex_/);
    expect(secondUrl).toMatch(/\/executions\/wex_/);
  });

  test("cancel a running execution", async ({ page, testWaitWorkflow }) => {
    await navigateToWorkflowDetail(
      page,
      testWaitWorkflow.org,
      testWaitWorkflow.slug,
    );
    await openRunDialog(page);
    await submitRunAndWaitForExecution(page);
    await assertNoErrorBoundary(page);

    await waitForPhaseBadge(page, "Running", { timeout: 15_000 });

    await clickCancel(page);
    await waitForPhaseTransition(page, "Cancelled", { timeout: 10_000 });

    await expect(
      page.getByRole("button", { name: "Pause" }),
    ).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Cancel" }),
    ).not.toBeVisible();
  });
});
