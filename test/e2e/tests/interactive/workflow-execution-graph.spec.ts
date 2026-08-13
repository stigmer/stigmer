import { test, expect } from "../../fixtures";
import { createTestWorkflowExecution } from "../../fixtures/seed-helpers";
import {
  navigateToExecution,
  waitForPhaseBadge,
  switchCenterView,
  getExecutionGraph,
} from "../../helpers/workflow-execution";
import { assertNoErrorBoundary } from "../../helpers/navigation";

// The execution page is thread-primary (the 2026-07 redesign): the DAG
// graph is a passive visualization behind the "Graph" center-view radio,
// CSS-hidden by default. Every test here switches views first — and all
// graph locators scope through the graph wrapper, because the hidden
// thread (and the editor pages' canvases in other specs) make bare
// `.react-flow` selectors ambiguous.
//
// Retired promises this file used to carry, and where they live now:
// - node click → inspector aside: task detail lives ON the thread card
//   (workflow-execution-thread.spec.ts); the graph wires no selection.
// - "Event Timeline" drawer: retired with the bottom drawer; per-task
//   visibility is the thread's job.
test.describe("Workflow execution graph (T04)", () => {
  test("Graph view renders the workflow graph canvas", async ({
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
      await switchCenterView(page, "graph");

      await expect(getExecutionGraph(page)).toBeVisible({ timeout: 10_000 });
    } finally {
      await execution.cleanup();
    }
  });

  test("completed nodes show success execution status", async ({
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
      await switchCenterView(page, "graph");

      const completedNodes = getExecutionGraph(page).locator(
        '[data-execution-status="completed"]',
      );
      await expect(completedNodes.first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await execution.cleanup();
    }
  });

  test("graph is read-only by default (nodes are not draggable)", async ({
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
      await switchCenterView(page, "graph");

      const graph = getExecutionGraph(page);
      await expect(graph).toBeVisible({ timeout: 10_000 });

      const firstNode = graph.locator("[data-execution-status]").first();
      await expect(firstNode).toBeVisible();

      // Read-only means the node's MODEL position cannot change — assert
      // the React Flow wrapper's transform (flow coordinates), not the
      // client rect: dragging on a non-draggable node legitimately PANS
      // the canvas, which moves every client rect without moving any node.
      const nodeWrapper = graph.locator(".react-flow__node").first();
      const transformBefore = await nodeWrapper.getAttribute("style");

      const box = await firstNode.boundingBox();
      expect(box).not.toBeNull();

      await firstNode.hover();
      await page.mouse.down();
      await page.mouse.move(box!.x + 100, box!.y + 100);
      await page.mouse.up();

      const transformAfter = await nodeWrapper.getAttribute("style");
      expect(transformAfter).toBe(transformBefore);
    } finally {
      await execution.cleanup();
    }
  });

  test("zoom controls are present", async ({
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
      await switchCenterView(page, "graph");

      const controls = getExecutionGraph(page).locator(".react-flow__controls");
      await expect(controls).toBeVisible({ timeout: 10_000 });
    } finally {
      await execution.cleanup();
    }
  });

  test("switching back to Thread hides the graph without unmounting it", async ({
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
      await switchCenterView(page, "graph");
      await expect(getExecutionGraph(page)).toBeVisible({ timeout: 10_000 });

      // The toggle contract: both views stay mounted (no React Flow
      // remount, no stream reconnect), the inactive one CSS-hidden.
      await switchCenterView(page, "thread");
      await expect(getExecutionGraph(page)).toBeHidden();
      await expect(getExecutionGraph(page)).toBeAttached();
    } finally {
      await execution.cleanup();
    }
  });
});
