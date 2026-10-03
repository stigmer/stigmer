import type { Page } from "@playwright/test";
import { test, expect } from "../../fixtures";
import {
  getEditorCanvas,
  navigateToVisualEditor,
} from "../../helpers/workflow-canvas";
import { assertNoErrorBoundary } from "../../helpers/navigation";

/**
 * Workflow inspector panel tests.
 *
 * Verifies the editor inspector panel behavior against a seeded
 * multi-kind workflow: empty state, tabbed layout, per-kind forms, node
 * actions, and deselection. (The pre-oss#571 version discovered "any
 * existing workflow" from the library — vacuous on a fresh stack.)
 */

/**
 * The first REAL task node on the editor canvas — scoped (the Overview
 * tabpanel mounts a second canvas). Sentinels carry no data-task-kind
 * (oss#581), so the bare attribute selector matches task nodes only.
 */
function getFirstTaskNode(page: Page) {
  return getEditorCanvas(page).locator("[data-task-kind]").first();
}

test.describe("Workflow inspector panel", () => {
  test("with nothing selected, the inspector summarises the workflow and its five tasks", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );
    await assertNoErrorBoundary(page);

    // The editor's empty inspector is the workflow summary
    // (WorkflowSummaryPanel): the workflow's name and its task count. The
    // multi-kind fixture seeds five tasks.
    await expect(
      page.getByRole("heading", { level: 3, name: testMultiKindWorkflow.slug }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("5 tasks", { exact: true })).toBeVisible();
  });

  test("selecting a node shows tabbed inspector", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    await getFirstTaskNode(page).click();

    await expect(page.getByRole("tab", { name: "Configure" })).toBeVisible({
      timeout: 5_000,
    });
  });

  test("tab navigation works between Configure, Data, and Advanced", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    await getFirstTaskNode(page).click();
    await expect(page.getByRole("tab", { name: "Configure" })).toBeVisible({
      timeout: 5_000,
    });

    const dataTab = page.getByRole("tab", { name: "Data" });
    await expect(dataTab).toBeVisible();
    await dataTab.click();
    await expect(dataTab).toHaveAttribute("aria-selected", "true");

    const advancedTab = page.getByRole("tab", { name: "Advanced" });
    await expect(advancedTab).toBeVisible();
    await advancedTab.click();
    await expect(advancedTab).toHaveAttribute("aria-selected", "true");
  });

  test("an agent_call node shows the agent and message fields", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    // The multi-kind fixture's classify_input task is an agent_call.
    const agentNode = getEditorCanvas(page)
      .locator('[data-task-kind="agent_call"]')
      .first();
    await expect(agentNode).toBeVisible({ timeout: 10_000 });
    await agentNode.click();

    const agentInput = page.locator('[data-testid="agent-call-agent-input"]');
    const messageInput = page.locator('[data-testid="agent-call-message-input"]');

    await expect(agentInput).toBeVisible({ timeout: 5_000 });
    await expect(messageInput).toBeVisible();
  });

  test("the node actions menu offers Duplicate and Delete task", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    await getFirstTaskNode(page).click();
    await expect(page.getByRole("tab", { name: "Configure" })).toBeVisible({
      timeout: 5_000,
    });

    const actionsButton = page.locator('[aria-label="Node actions"]');
    await expect(actionsButton).toBeVisible({ timeout: 5_000 });
    await actionsButton.click();

    const menu = page.locator('[role="menu"]');
    await expect(menu).toBeVisible({ timeout: 2_000 });

    await expect(menu.getByRole("menuitem", { name: "Duplicate" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Delete task" })).toBeVisible();
  });

  test("deselecting returns to empty state", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );

    await getFirstTaskNode(page).click();

    const configureTab = page.getByRole("tab", { name: "Configure" });
    await expect(configureTab).toBeVisible({ timeout: 5_000 });

    // Click empty canvas (top-right corner — clear of the toolbar,
    // Controls, and minimap overlays) to deselect.
    const paneBox = await getEditorCanvas(page)
      .locator(".react-flow__pane")
      .boundingBox();
    expect(paneBox).not.toBeNull();
    await page.mouse.click(paneBox!.x + paneBox!.width - 40, paneBox!.y + 40);

    await expect(configureTab).not.toBeVisible({ timeout: 5_000 });
  });
});
