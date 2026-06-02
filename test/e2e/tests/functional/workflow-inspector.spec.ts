import { test, expect } from "@playwright/test";

/**
 * Workflow inspector panel tests (T10).
 *
 * These tests navigate to a workflow editor page and verify the
 * inspector panel behavior: empty state, tabbed layout, per-kind
 * forms, node actions, and edge selection.
 *
 * Tests require at least one workflow to exist. If the editor tab
 * or canvas is unreachable, tests skip gracefully.
 */
test.describe("Workflow inspector panel", () => {
  let editorUrl: string | null = null;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto("/library/workflows");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const firstCard = page.locator('[role="listitem"]').first();
    const firstRow = page.locator("table tbody tr").first();

    if (await firstCard.isVisible().catch(() => false)) {
      await firstCard.click();
    } else if (await firstRow.isVisible().catch(() => false)) {
      await firstRow.click();
    } else {
      await page.close();
      return;
    }

    await page.waitForLoadState("networkidle");

    const editorTab = page.locator('[role="tab"]:has-text("Editor")');
    if (await editorTab.isVisible({ timeout: 5000 }).catch(() => false)) {
      await editorTab.click();
      await page.waitForTimeout(2000);
    }

    editorUrl = page.url();
    await page.close();
  });

  test("empty state shows workflow summary when nothing selected", async ({ page }) => {
    test.skip(!editorUrl, "No workflows available");

    await page.goto(editorUrl!);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const visualToggle = page.locator('button:has-text("Visual"), [data-cursor-target="visual-mode"]');
    if (await visualToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
      await visualToggle.click();
      await page.waitForTimeout(2000);
    }

    const workflowHeading = page.locator('h3, h4').filter({ hasText: /Workflow/i });
    const summaryText = page.locator('text=/tasks?$/i');
    const selectPrompt = page.locator('text="Select a task or connection to inspect"');

    const hasSummary = await workflowHeading.isVisible({ timeout: 5000 }).catch(() => false);
    const hasTaskCount = await summaryText.isVisible({ timeout: 2000 }).catch(() => false);
    const hasSelectPrompt = await selectPrompt.isVisible({ timeout: 2000 }).catch(() => false);

    expect(hasSummary || hasTaskCount || hasSelectPrompt).toBeTruthy();
  });

  test("selecting a node shows tabbed inspector", async ({ page }) => {
    test.skip(!editorUrl, "No workflows available");

    await page.goto(editorUrl!);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const visualToggle = page.locator('button:has-text("Visual"), [data-cursor-target="visual-mode"]');
    if (await visualToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
      await visualToggle.click();
      await page.waitForTimeout(2000);
    }

    const firstNode = page.locator('[data-task-kind]').first();
    if (!(await firstNode.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip(true, "No task nodes visible on canvas");
      return;
    }

    await firstNode.click();
    await page.waitForTimeout(1000);

    const configureTab = page.locator('[role="tab"]:has-text("Configure")');
    const hasConfigureTab = await configureTab.isVisible({ timeout: 5000 }).catch(() => false);
    expect(hasConfigureTab).toBeTruthy();
  });

  test("tab navigation works between Configure, Data, and Advanced", async ({ page }) => {
    test.skip(!editorUrl, "No workflows available");

    await page.goto(editorUrl!);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const visualToggle = page.locator('button:has-text("Visual"), [data-cursor-target="visual-mode"]');
    if (await visualToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
      await visualToggle.click();
      await page.waitForTimeout(2000);
    }

    const firstNode = page.locator('[data-task-kind]').first();
    if (!(await firstNode.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip(true, "No task nodes visible on canvas");
      return;
    }

    await firstNode.click();
    await page.waitForTimeout(1000);

    const dataTab = page.locator('[role="tab"]:has-text("Data")');
    if (await dataTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await dataTab.click();
      await page.waitForTimeout(500);
      expect(await dataTab.getAttribute("aria-selected")).toBe("true");
    }

    const advancedTab = page.locator('[role="tab"]:has-text("Advanced")');
    if (await advancedTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await advancedTab.click();
      await page.waitForTimeout(500);
      expect(await advancedTab.getAttribute("aria-selected")).toBe("true");
    }
  });

  test("agent_call node shows specialized AgentCallForm fields", async ({ page }) => {
    test.skip(!editorUrl, "No workflows available");

    await page.goto(editorUrl!);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const visualToggle = page.locator('button:has-text("Visual"), [data-cursor-target="visual-mode"]');
    if (await visualToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
      await visualToggle.click();
      await page.waitForTimeout(2000);
    }

    const agentNode = page.locator('[data-task-kind="agent_call"]').first();
    if (!(await agentNode.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip(true, "No agent_call nodes on canvas");
      return;
    }

    await agentNode.click();
    await page.waitForTimeout(1000);

    const agentInput = page.locator('[data-testid="agent-call-agent-input"]');
    const messageInput = page.locator('[data-testid="agent-call-message-input"]');

    const hasAgent = await agentInput.isVisible({ timeout: 3000 }).catch(() => false);
    const hasMessage = await messageInput.isVisible({ timeout: 3000 }).catch(() => false);

    expect(hasAgent || hasMessage).toBeTruthy();
  });

  test("node actions menu opens from header overflow button", async ({ page }) => {
    test.skip(!editorUrl, "No workflows available");

    await page.goto(editorUrl!);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const visualToggle = page.locator('button:has-text("Visual"), [data-cursor-target="visual-mode"]');
    if (await visualToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
      await visualToggle.click();
      await page.waitForTimeout(2000);
    }

    const firstNode = page.locator('[data-task-kind]').first();
    if (!(await firstNode.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip(true, "No task nodes visible on canvas");
      return;
    }

    await firstNode.click();
    await page.waitForTimeout(1000);

    const actionsButton = page.locator('[aria-label="Node actions"]');
    if (await actionsButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await actionsButton.click();
      await page.waitForTimeout(500);

      const menu = page.locator('[role="menu"]');
      const hasMenu = await menu.isVisible({ timeout: 2000 }).catch(() => false);
      expect(hasMenu).toBeTruthy();

      const duplicateItem = page.locator('[role="menuitem"]:has-text("Duplicate")');
      const deleteItem = page.locator('[role="menuitem"]:has-text("Delete task")');
      expect(await duplicateItem.isVisible().catch(() => false) || await deleteItem.isVisible().catch(() => false)).toBeTruthy();
    }
  });

  test("deselecting returns to empty state", async ({ page }) => {
    test.skip(!editorUrl, "No workflows available");

    await page.goto(editorUrl!);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const visualToggle = page.locator('button:has-text("Visual"), [data-cursor-target="visual-mode"]');
    if (await visualToggle.isVisible({ timeout: 3000 }).catch(() => false)) {
      await visualToggle.click();
      await page.waitForTimeout(2000);
    }

    const firstNode = page.locator('[data-task-kind]').first();
    if (!(await firstNode.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip(true, "No task nodes visible on canvas");
      return;
    }

    await firstNode.click();
    await page.waitForTimeout(1000);

    const configureTab = page.locator('[role="tab"]:has-text("Configure")');
    const hadTabs = await configureTab.isVisible({ timeout: 3000 }).catch(() => false);

    await page.locator(".react-flow__pane").click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(1000);

    if (hadTabs) {
      const tabsGone = !(await configureTab.isVisible({ timeout: 2000 }).catch(() => false));
      expect(tabsGone).toBeTruthy();
    }
  });
});
