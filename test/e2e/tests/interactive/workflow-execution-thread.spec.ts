import { test, expect } from "../../fixtures";
import { createTestWorkflowExecution } from "../../fixtures/seed-helpers";
import {
  navigateToExecution,
  waitForPhaseBadge,
  getCenterViewSwitcher,
  getCenterViewWrapper,
  getExecutionThread,
  getThreadTaskCards,
  getThreadTaskCard,
  openExecutionPanel,
  getPanelToggle,
  getPanelResizeHandle,
} from "../../helpers/workflow-execution";
import { assertNoErrorBoundary } from "../../helpers/navigation";

// The task thread is the PRIMARY surface of the redesigned execution page
// (project 20260714.02, thread-primary pivot): one card per started task,
// with the card as the single home for that task's status, timing, and
// I/O. This file is the successor of the retired waterfall and inspector
// specs — their durable promises (per-task rows, visible timing, task
// detail on demand, an accessible side panel) re-homed onto the surfaces
// that now carry them.
test.describe("Workflow execution thread", () => {
  test("Thread is the default center view; the graph stays mounted but hidden", async ({
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

      const switcher = getCenterViewSwitcher(page);
      await expect(
        switcher.getByRole("radio", { name: "Thread" }),
      ).toHaveAttribute("aria-checked", "true");

      await expect(getExecutionThread(page)).toBeVisible();
      await expect(getCenterViewWrapper(page, "graph")).toBeHidden();
      await expect(getCenterViewWrapper(page, "graph")).toBeAttached();
    } finally {
      await execution.cleanup();
    }
  });

  test("each executed task gets a card with its name, kind, and duration", async ({
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

      // The retired waterfall's promise, on its successor surface: every
      // executed task is a row with visible timing. The fixture runs
      // exactly two set_vars tasks.
      await expect(getThreadTaskCards(page)).toHaveCount(2, {
        timeout: 30_000,
      });

      for (const taskName of ["step_one", "step_two"]) {
        const card = getThreadTaskCard(page, taskName);
        await expect(card).toBeVisible();
        // Kind label (uppercase-styled) and a duration meta chip.
        await expect(card).toContainText("set variables", {
          ignoreCase: true,
        });
        await expect(card).toContainText(/\d+(\.\d+)?\s?(ms|s|m)/);
      }
    } finally {
      await execution.cleanup();
    }
  });

  test("set_vars cards carry an always-visible output body", async ({
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

      // Preview-kind cards (T04): the output body renders without any
      // expand gesture — a user scans results straight down the thread.
      const card = getThreadTaskCard(page, "step_one");
      const previewBody = card.locator('[data-cursor-target="task-preview"]');
      await expect(previewBody).toBeVisible({ timeout: 15_000 });
      await expect(previewBody).toContainText("Output");
    } finally {
      await execution.cleanup();
    }
  });

  test("a body-less summary-kind card is a plain header row — status and duration live on the header", async ({
    page,
    stigmerClient,
    testWaitWorkflow,
  }) => {
    const execution = await createTestWorkflowExecution(
      stigmerClient,
      testWaitWorkflow.id,
    );

    try {
      await navigateToExecution(page, execution.id);
      await assertNoErrorBoundary(page);
      // The wait workflow blocks ~10s before completing.
      await waitForPhaseBadge(page, "Completed", { timeout: 45_000 });

      // The retired inspector's promise, on its successor surface: since
      // R6-6 the card HEADER is the single source for a task's status
      // (glyph) and duration (meta chip) — the old Status/Duration detail
      // rows are gone. A settled wait task has nothing left for a detail
      // body, so the card offers no expand gesture at all (stigmer#886) —
      // the same no-toggle contract tool-call-disclosure.spec.ts pins for
      // always-visible session cards.
      const card = getThreadTaskCard(page, "blocking_wait");
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card).toContainText("Wait"); // kind label
      await expect(card).toContainText(/\d+(\.\d+)?\s?(ms|s|m)/); // duration chip
      await expect(card.locator('[role="button"][aria-expanded]')).toHaveCount(0);
    } finally {
      await execution.cleanup();
    }
  });

  test("progress header reports settled task counts", async ({
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

      await expect(getExecutionThread(page)).toContainText("2 of 2 tasks", {
        timeout: 15_000,
      });
    } finally {
      await execution.cleanup();
    }
  });

  test("an always-visible polite live region announces task state changes", async ({
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

      // The a11y promise the graph's announcer used to carry: one
      // viewer-owned live region that stays in the accessibility tree in
      // BOTH center views (a region inside the CSS-hidden graph would go
      // silent in Thread view).
      const announcer = page.locator('[role="log"][aria-live="polite"]');
      await expect(announcer).toBeAttached();
    } finally {
      await execution.cleanup();
    }
  });

  test("the workspace panel opens from the header chip with Artifacts/Changes/Usage facets and an accessible resize handle", async ({
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

      // Collapsed by default: the resize handle is aria-hidden until open.
      await expect(getPanelResizeHandle(page)).not.toBeVisible();

      await openExecutionPanel(page);

      // The execution-level facet rail (labels may carry count badges).
      for (const facet of [/^Artifacts/, /^Changes/, /^Usage/]) {
        await expect(page.getByRole("radio", { name: facet })).toBeVisible();
      }

      // The retired inspector spec's a11y promise, re-homed: the panel
      // split's resize handle is a real separator with an accessible name.
      const separator = getPanelResizeHandle(page);
      await expect(separator).toBeVisible();
      await expect(separator).toHaveAttribute("aria-orientation", "vertical");

      // And it collapses back to the chip.
      await getPanelToggle(page).click();
      await expect(getPanelResizeHandle(page)).not.toBeVisible();
    } finally {
      await execution.cleanup();
    }
  });
});
