import { test, expect } from "../../fixtures";
import { createTestWorkflowExecution } from "../../fixtures/seed-helpers";
import {
  navigateToExecution,
  waitForPhaseBadge,
  getCenterViewSwitcher,
  getExecutionThread,
  getThreadTaskCards,
  getThreadTaskCard,
} from "../../helpers/workflow-execution";
import { assertNoErrorBoundary } from "../../helpers/navigation";

// End-to-end flow on the thread-primary execution page (the 2026-07
// redesign): the retired "Execution timeline" list's promise — every
// executed task is visible with its outcome — now lives on the thread's
// task cards. Task-name assertions must scope to the thread: the page
// also renders task names in the sr-only live announcer and on the
// (hidden) graph canvas, so a page-wide getByText is a strict-mode
// violation by construction.
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

  test("thread shows one card per executed task after completion", async ({
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

      // The fixture workflow has exactly two set_vars tasks; both ran, so
      // the thread renders exactly two cards (pending tasks render none).
      await expect(getThreadTaskCards(page)).toHaveCount(2, {
        timeout: 30_000,
      });
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

      await expect(getThreadTaskCard(page, "step_one")).toBeVisible();
      await expect(getThreadTaskCard(page, "step_two")).toBeVisible();
    } finally {
      await execution.cleanup();
    }
  });

  test("header and thread render within the viewport (no clipping)", async ({
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
      // viewport-height calc), which pushed the header above the
      // scrollport and the right column past the right edge.
      // `toBeVisible()` alone is insufficient — a clipped element can
      // still be "visible" in the DOM — so assert viewport bounds on the
      // header badge and the thread column (the old aside is retired).
      const badge = page.getByRole("status", { name: "Completed" });
      const badgeBox = await badge.boundingBox();
      expect(badgeBox).not.toBeNull();
      expect(badgeBox!.y).toBeGreaterThanOrEqual(0);

      const thread = getExecutionThread(page);
      await expect(thread).toBeVisible();
      const threadBox = await thread.boundingBox();
      expect(threadBox).not.toBeNull();
      expect(threadBox!.x).toBeGreaterThanOrEqual(0);
      expect(threadBox!.x + threadBox!.width).toBeLessThanOrEqual(
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
      await expect(getCenterViewSwitcher(page)).toBeVisible();

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
