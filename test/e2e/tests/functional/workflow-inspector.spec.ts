import type { Page } from "@playwright/test";
import { test, expect } from "../../fixtures";
import {
  getEditorCanvas,
  navigateToVisualEditor,
} from "../../helpers/workflow-canvas";
import { assertNoErrorBoundary } from "../../helpers/navigation";

/**
 * Workflow inspector panel tests (T10).
 *
 * Verifies the editor inspector panel behavior against a seeded
 * multi-kind workflow: empty state, tabbed layout, per-kind forms, node
 * actions, and deselection. (The pre-oss#571 version discovered "any
 * existing workflow" from the library — vacuous on a fresh stack.)
 */

/**
 * The first REAL task node on the editor canvas — scoped (the Overview
 * tabpanel mounts a second canvas) and excluding the start/end sentinels
 * (also `[data-task-kind]` carriers, but non-selectable).
 */
function getFirstTaskNode(page: Page) {
  return getEditorCanvas(page)
    .locator('[data-task-kind]:not([data-visual-class="terminal-pill"])')
    .first();
}

test.describe("Workflow inspector panel", () => {
  test("empty state shows workflow summary when nothing selected", async ({
    page,
    testMultiKindWorkflow,
  }) => {
    await navigateToVisualEditor(
      page,
      testMultiKindWorkflow.org,
      testMultiKindWorkflow.slug,
    );
    await assertNoErrorBoundary(page);

    const workflowHeading = page.locator("h3, h4").filter({ hasText: /Workflow/i });
    const summaryText = page.locator("text=/tasks?$/i");
    const selectPrompt = page.locator('text="Select a task or connection to inspect"');

    const hasSummary = await workflowHeading.first().isVisible({ timeout: 5000 }).catch(() => false);
    const hasTaskCount = await summaryText.first().isVisible({ timeout: 2000 }).catch(() => false);
    const hasSelectPrompt = await selectPrompt.isVisible({ timeout: 2000 }).catch(() => false);

    expect(hasSummary || hasTaskCount || hasSelectPrompt).toBeTruthy();
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

  test("agent_call node shows specialized AgentCallForm fields", async ({
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

    const hasAgent = await agentInput.isVisible({ timeout: 5000 }).catch(() => false);
    const hasMessage = await messageInput.isVisible({ timeout: 2000 }).catch(() => false);

    expect(hasAgent || hasMessage).toBeTruthy();
  });

  test("node actions menu opens from header overflow button", async ({
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

    const duplicateItem = page.locator('[role="menuitem"]:has-text("Duplicate")');
    const deleteItem = page.locator('[role="menuitem"]:has-text("Delete task")');
    expect(
      (await duplicateItem.isVisible().catch(() => false)) ||
        (await deleteItem.isVisible().catch(() => false)),
    ).toBeTruthy();
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
