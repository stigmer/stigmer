import { test, expect } from "@playwright/test";

/**
 * T12: Workflow overview page tests.
 *
 * Validates the redesigned Overview tab renders a React Flow graph
 * (replacing the legacy SVG topology), summary stat cards, and
 * interactive node popovers.
 *
 * Requires at least one workflow to exist in the local dev server.
 * Tests skip gracefully when no workflows are available.
 */
test.describe("Workflow overview page", () => {
  let workflowUrl: string | null = null;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto("/library/workflows");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const firstCard = page.locator('[role="listitem"]').first();
    const firstRow = page.locator("table tbody tr").first();

    if (await firstCard.isVisible().catch(() => false)) {
      await firstCard.click();
      await page.waitForLoadState("networkidle");
      workflowUrl = page.url();
    } else if (await firstRow.isVisible().catch(() => false)) {
      await firstRow.click();
      await page.waitForLoadState("networkidle");
      workflowUrl = page.url();
    }

    await page.close();
  });

  test("overview tab renders React Flow graph instead of SVG", async ({ page }) => {
    test.skip(!workflowUrl, "No workflows available");

    await page.goto(workflowUrl!);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const overviewTab = page.locator('[role="tab"]:has-text("Overview")');
    await expect(overviewTab).toBeVisible({ timeout: 10_000 });
    await overviewTab.click();

    // React Flow renders a div with class "react-flow" — verify it's present
    const reactFlowContainer = page.locator(".react-flow");
    await expect(reactFlowContainer).toBeVisible({ timeout: 10_000 });

    // The old SVG topology graph used role="img" aria-label="Workflow topology graph"
    const oldSvgGraph = page.locator('[aria-label="Workflow topology graph"]');
    await expect(oldSvgGraph).toHaveCount(0);
  });

  test("React Flow graph has zoom controls", async ({ page }) => {
    test.skip(!workflowUrl, "No workflows available");

    await page.goto(workflowUrl!);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const overviewTab = page.locator('[role="tab"]:has-text("Overview")');
    await overviewTab.click();

    // React Flow Controls component renders buttons for zoom
    const controls = page.locator(".react-flow__controls");
    await expect(controls).toBeVisible({ timeout: 10_000 });
  });

  test("summary cards section is present", async ({ page }) => {
    test.skip(!workflowUrl, "No workflows available");

    await page.goto(workflowUrl!);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const overviewTab = page.locator('[role="tab"]:has-text("Overview")');
    await overviewTab.click();

    // Summary cards render with stat labels — at minimum one should be visible
    // (either skeleton cards while loading, or "No executions yet" empty state,
    // or the actual stat cards)
    const summarySection = page.locator("text=Total Executions").or(
      page.locator("text=Success Rate"),
    ).or(
      page.locator("text=No executions yet"),
    );
    await expect(summarySection.first()).toBeVisible({ timeout: 10_000 });
  });

  test("clicking a task node opens a popover", async ({ page }) => {
    test.skip(!workflowUrl, "No workflows available");

    await page.goto(workflowUrl!);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const overviewTab = page.locator('[role="tab"]:has-text("Overview")');
    await overviewTab.click();

    // Wait for the React Flow graph to render with nodes
    const reactFlowNode = page.locator(".react-flow__node").first();
    const nodeVisible = await reactFlowNode.isVisible().catch(() => false);
    test.skip(!nodeVisible, "No graph nodes rendered");

    // Find a non-sentinel node — sentinels carry no data-task-kind (oss#581),
    // so the bare attribute selector matches real task nodes only.
    const taskNode = page.locator("[data-task-kind]").first();
    const taskVisible = await taskNode.isVisible().catch(() => false);
    test.skip(!taskVisible, "No task nodes rendered");

    await taskNode.click();

    // Popover should appear with a dialog role
    const popover = page.locator('[role="dialog"]');
    await expect(popover).toBeVisible({ timeout: 5_000 });
  });

  test("editor tab is accessible via quick action or tab bar", async ({ page }) => {
    test.skip(!workflowUrl, "No workflows available");

    await page.goto(workflowUrl!);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // The Editor tab should be present in the tab bar (added by client app)
    const editorTab = page.locator('[role="tab"]:has-text("Editor")');
    await expect(editorTab).toBeVisible({ timeout: 10_000 });
  });
});
