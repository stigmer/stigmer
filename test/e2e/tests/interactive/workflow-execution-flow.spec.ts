import { test, expect } from "../../fixtures";
import { createTestWorkflowExecution } from "../../fixtures/seed-helpers";
import {
  navigateToExecution,
  waitForPhaseBadge,
  getExecutionTimeline,
  verifyTimelineHasEvents,
  getExecutionInspector,
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

      await expect(page.getByText("step_one")).toBeVisible();
      await expect(page.getByText("step_two")).toBeVisible();
    } finally {
      await execution.cleanup();
    }
  });

  test("header and right inspector render within the viewport (no clipping)", async ({
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

      const viewport = page.viewportSize();
      expect(viewport).not.toBeNull();

      // Regression guard for the broken page shell (`-mx-6 -my-8` +
      // viewport-height calc), which pushed the header above the scrollport
      // and the right inspector past the right edge. `toBeVisible()` alone is
      // insufficient — a clipped element can still be "visible" in the DOM —
      // so we assert the elements sit inside the viewport bounds.
      const badge = page.getByRole("status", { name: "Completed" });
      const badgeBox = await badge.boundingBox();
      expect(badgeBox).not.toBeNull();
      expect(badgeBox!.y).toBeGreaterThanOrEqual(0);

      const inspector = getExecutionInspector(page).first();
      await expect(inspector).toBeVisible();
      const inspectorBox = await inspector.boundingBox();
      expect(inspectorBox).not.toBeNull();
      expect(inspectorBox!.x).toBeGreaterThanOrEqual(0);
      expect(inspectorBox!.x + inspectorBox!.width).toBeLessThanOrEqual(
        viewport!.width + 1,
      );
    } finally {
      await execution.cleanup();
    }
  });

  test("opening an execution from the sidebar does not reload the page", async ({
    page,
    stigmerClient,
    testWorkflow,
  }) => {
    const execution = await createTestWorkflowExecution(
      stigmerClient,
      testWorkflow.id,
    );

    try {
      // Land on the session-zone home so the sidebar "Recents" render, then
      // wait for this execution to surface as an in-app link.
      await page.goto("/");
      const link = page.locator(`a[href="/executions/${execution.id}"]`);
      await expect(link).toBeVisible({ timeout: 20_000 });

      // A full document navigation would wipe this window-scoped sentinel;
      // soft navigation (history.pushState) preserves it.
      await page.evaluate(() => {
        (window as Window & { __noReloadSentinel?: string }).__noReloadSentinel =
          "kept";
      });

      await link.click();

      await expect(page).toHaveURL(new RegExp(`/executions/${execution.id}$`));
      await assertNoErrorBoundary(page);
      await waitForPhaseBadge(page, "Completed", { timeout: 30_000 });
      await expect(getExecutionInspector(page).first()).toBeVisible();

      const sentinel = await page.evaluate(
        () =>
          (window as Window & { __noReloadSentinel?: string })
            .__noReloadSentinel,
      );
      expect(sentinel).toBe("kept");
    } finally {
      await execution.cleanup();
    }
  });
});
