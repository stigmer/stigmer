import { test, expect } from "@playwright/test";

test.describe("Workflow template gallery", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/library/workflows/new");
    await page.waitForLoadState("networkidle");
  });

  test("renders creation picker with three options", async ({ page }) => {
    const heading = page.locator('h2:has-text("Create a new workflow")');
    await expect(heading).toBeVisible({ timeout: 10_000 });

    const templateOption = page.locator('button:has-text("Start from template")');
    await expect(templateOption).toBeVisible();

    const editorOption = page.locator('button:has-text("Visual Editor")');
    await expect(editorOption).toBeVisible();

    const aiOption = page.locator('button:has-text("Generate with AI")');
    await expect(aiOption).toBeVisible();
  });

  test("shows template count badge", async ({ page }) => {
    const badge = page.locator('text="8 available"');
    await expect(badge).toBeVisible({ timeout: 10_000 });
  });

  test("clicking template option navigates to gallery", async ({ page }) => {
    const templateOption = page.locator('button:has-text("Start from template")');
    await expect(templateOption).toBeVisible({ timeout: 10_000 });
    await templateOption.click();

    const galleryHeading = page.locator('h2:has-text("Choose a template")');
    await expect(galleryHeading).toBeVisible();

    const searchInput = page.locator('input[placeholder="Search templates…"]');
    await expect(searchInput).toBeVisible();
  });

  test("gallery displays template cards", async ({ page }) => {
    const templateOption = page.locator('button:has-text("Start from template")');
    await expect(templateOption).toBeVisible({ timeout: 10_000 });
    await templateOption.click();

    const cardList = page.locator('[role="list"][aria-label="Workflow templates"]');
    await expect(cardList).toBeVisible();

    const cards = cardList.locator('[role="listitem"]');
    await expect(cards).toHaveCount(8);
  });

  test("search filters template cards", async ({ page }) => {
    const templateOption = page.locator('button:has-text("Start from template")');
    await expect(templateOption).toBeVisible({ timeout: 10_000 });
    await templateOption.click();

    const searchInput = page.locator('input[placeholder="Search templates…"]');
    await searchInput.fill("triage");

    const cards = page.locator('[role="list"][aria-label="Workflow templates"] [role="listitem"]');
    await expect(cards).toHaveCount(1);

    const triageCard = page.locator('text="Support Ticket Triage"');
    await expect(triageCard).toBeVisible();
  });

  test("category tabs filter template cards", async ({ page }) => {
    const templateOption = page.locator('button:has-text("Start from template")');
    await expect(templateOption).toBeVisible({ timeout: 10_000 });
    await templateOption.click();

    const integrationTab = page.locator('[role="tab"]:has-text("Integration")');
    await integrationTab.click();

    const cards = page.locator('[role="list"][aria-label="Workflow templates"] [role="listitem"]');
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(8);
  });

  test("back button returns to creation picker", async ({ page }) => {
    const templateOption = page.locator('button:has-text("Start from template")');
    await expect(templateOption).toBeVisible({ timeout: 10_000 });
    await templateOption.click();

    const galleryHeading = page.locator('h2:has-text("Choose a template")');
    await expect(galleryHeading).toBeVisible();

    const backButton = page.locator('[aria-label="Back to creation options"]');
    await backButton.click();

    const pickerHeading = page.locator('h2:has-text("Create a new workflow")');
    await expect(pickerHeading).toBeVisible();
  });

  test("selecting a template card opens the editor", async ({ page }) => {
    const templateOption = page.locator('button:has-text("Start from template")');
    await expect(templateOption).toBeVisible({ timeout: 10_000 });
    await templateOption.click();

    const researchCard = page.locator(
      '[aria-label="Use Research & Summarize template"]',
    );
    await expect(researchCard).toBeVisible();
    await researchCard.click();

    const backButton = page.locator('button:has-text("Back")');
    await expect(backButton).toBeVisible({ timeout: 10_000 });

    const editorHeader = page.locator('text="New workflow"');
    await expect(editorHeader).toBeVisible();
  });

  test("template cards show pattern badges", async ({ page }) => {
    const templateOption = page.locator('button:has-text("Start from template")');
    await expect(templateOption).toBeVisible({ timeout: 10_000 });
    await templateOption.click();

    const parallelBadge = page.locator('span:has-text("Parallel")').first();
    await expect(parallelBadge).toBeVisible();

    const branchingBadge = page.locator('span:has-text("Branching")').first();
    await expect(branchingBadge).toBeVisible();

    const hitlBadge = page.locator('span:has-text("Human-in-the-Loop")').first();
    await expect(hitlBadge).toBeVisible();
  });

  test("template cards show task count metadata", async ({ page }) => {
    const templateOption = page.locator('button:has-text("Start from template")');
    await expect(templateOption).toBeVisible({ timeout: 10_000 });
    await templateOption.click();

    const taskCount = page.locator('span:has-text("tasks")').first();
    await expect(taskCount).toBeVisible();
  });

  test("empty search shows no-match message", async ({ page }) => {
    const templateOption = page.locator('button:has-text("Start from template")');
    await expect(templateOption).toBeVisible({ timeout: 10_000 });
    await templateOption.click();

    const searchInput = page.locator('input[placeholder="Search templates…"]');
    await searchInput.fill("nonexistent-workflow-xyz-999");

    const emptyMessage = page.locator('text="No templates match your search."');
    await expect(emptyMessage).toBeVisible();
  });
});
