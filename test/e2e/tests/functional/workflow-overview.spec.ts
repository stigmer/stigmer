import type { Page } from "@playwright/test";
import { test, expect } from "../../fixtures";
import { navigateToWorkflowDetail } from "../../helpers/workflow-detail";
import { getOverviewCanvas } from "../../helpers/workflow-canvas";
import { assertNoErrorBoundary } from "../../helpers/navigation";

/**
 * T12: Workflow overview page tests.
 *
 * Validates the redesigned Overview tab renders a React Flow graph
 * (replacing the legacy SVG topology), summary stat cards, and
 * interactive node popovers.
 *
 * Seeds its own workflow (the multi-kind fixture) — the pre-oss#571
 * version discovered "any existing workflow" from the library, which is
 * vacuous on a fresh stack and nondeterministic on a shared one.
 */

async function openOverviewTab(
  page: Page,
  org: string,
  slug: string,
): Promise<void> {
  await navigateToWorkflowDetail(page, org, slug);
  await page.getByRole("tab", { name: "Overview" }).click();
}

test.describe("Workflow overview page", () => {
  test("overview tab renders React Flow graph instead of SVG", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await openOverviewTab(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );
    await assertNoErrorBoundary(page);

    // React Flow renders a div with class "react-flow" — scoped to the
    // Overview tabpanel: the Editor tabpanel mounts a second canvas
    // (dual-canvas hazard), so a bare `.react-flow` is a strict-mode
    // violation.
    await expect(getOverviewCanvas(page)).toBeVisible({ timeout: 10_000 });

    // The old SVG topology graph used role="img" aria-label="Workflow topology graph"
    const oldSvgGraph = page.locator('[aria-label="Workflow topology graph"]');
    await expect(oldSvgGraph).toHaveCount(0);
  });

  test("React Flow graph has zoom controls", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await openOverviewTab(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    // React Flow Controls component renders buttons for zoom
    const controls = getOverviewCanvas(page).locator(".react-flow__controls");
    await expect(controls).toBeVisible({ timeout: 10_000 });
  });

  test("summary cards section is present", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await openOverviewTab(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    // Summary cards render with stat labels — at minimum one should be
    // visible (skeletons while loading, "No executions yet" empty state,
    // or the actual stat cards). Scoped to the Overview tabpanel: the
    // hidden Executions tabpanel carries its own "No executions yet".
    const overviewPanel = page.getByRole("tabpanel", { name: "Overview" });
    const summarySection = overviewPanel.locator("text=Total Executions").or(
      overviewPanel.locator("text=Success Rate"),
    ).or(
      overviewPanel.locator("text=No executions yet"),
    );
    await expect(summarySection.first()).toBeVisible({ timeout: 10_000 });
  });

  test("clicking a task node opens a popover", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await openOverviewTab(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    const overviewCanvas = getOverviewCanvas(page);
    await expect(
      overviewCanvas.locator(".react-flow__node").first(),
    ).toBeVisible({ timeout: 10_000 });

    // A non-sentinel node (sentinels carry the terminal-pill visual class
    // — their data-task-kind is an enum-fallback artifact, not a stable
    // anchor)
    const taskNode = overviewCanvas
      .locator('[data-task-kind]:not([data-visual-class="terminal-pill"])')
      .first();
    await expect(taskNode).toBeVisible();
    await taskNode.click();

    // Popover should appear with a dialog role
    const popover = page.locator('[role="dialog"]');
    await expect(popover).toBeVisible({ timeout: 5_000 });
  });

  test("editor tab is accessible via quick action or tab bar", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToWorkflowDetail(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    // The Editor tab should be present in the tab bar
    await expect(page.getByRole("tab", { name: "Editor" })).toBeVisible({
      timeout: 10_000,
    });
  });
});
