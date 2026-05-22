import { test, expect } from "../../fixtures";
import { assertNoErrorBoundary } from "../../helpers/navigation";

async function navigateToEditorTab(
  page: import("@playwright/test").Page,
  org: string,
  slug: string,
) {
  await page.goto(`/library/workflows/${org}/${slug}`);
  await page
    .getByRole("tablist", { name: "Workflow detail tabs" })
    .waitFor({ timeout: 15_000 });
  await page.getByRole("tab", { name: "Editor" }).click();
  await page.waitForTimeout(2000);
}

test.describe("Workflow editor refine panel", () => {
  test("Editor tab shows Refine button", async ({ page, testWorkflow }) => {
    await navigateToEditorTab(page, testWorkflow.org, testWorkflow.slug);
    await assertNoErrorBoundary(page);

    await expect(
      page.getByRole("button", { name: "Refine with AI" }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("clicking Refine opens the refinement panel", async ({
    page,
    testWorkflow,
  }) => {
    await navigateToEditorTab(page, testWorkflow.org, testWorkflow.slug);

    await page.getByRole("button", { name: "Refine with AI" }).click();

    await expect(
      page.locator('[aria-label="Workflow refinement panel"]'),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("panel shows composer and empty state", async ({
    page,
    testWorkflow,
  }) => {
    await navigateToEditorTab(page, testWorkflow.org, testWorkflow.slug);
    await page.getByRole("button", { name: "Refine with AI" }).click();

    await expect(
      page.locator('[aria-label="Workflow refinement panel"]'),
    ).toBeVisible({ timeout: 10_000 });

    await expect(
      page.getByPlaceholder("What would you like to change?"),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByText("Describe the changes you want"),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Refine button shows pressed state when panel is open", async ({
    page,
    testWorkflow,
  }) => {
    await navigateToEditorTab(page, testWorkflow.org, testWorkflow.slug);

    const refineButton = page.getByRole("button", { name: "Refine with AI" });
    await refineButton.click();

    await expect(
      page.locator('[aria-label="Workflow refinement panel"]'),
    ).toBeVisible({ timeout: 10_000 });
    await expect(refineButton).toHaveAttribute("aria-pressed", "true");
  });

  test("close button dismisses the panel", async ({ page, testWorkflow }) => {
    await navigateToEditorTab(page, testWorkflow.org, testWorkflow.slug);

    await page.getByRole("button", { name: "Refine with AI" }).click();
    await expect(
      page.locator('[aria-label="Workflow refinement panel"]'),
    ).toBeVisible({ timeout: 10_000 });

    await page.getByLabel("Close refinement panel").click();

    await expect(
      page.locator('[aria-label="Workflow refinement panel"]'),
    ).not.toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("button", { name: "Refine with AI" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  test("mode toggle between Code and Visual is accessible", async ({
    page,
    testWorkflow,
  }) => {
    await navigateToEditorTab(page, testWorkflow.org, testWorkflow.slug);

    const modeTablist = page.getByRole("tablist", { name: "Editor mode" });
    await expect(modeTablist).toBeVisible({ timeout: 10_000 });
    await expect(
      modeTablist.getByRole("tab", { name: "Code" }),
    ).toBeVisible();
    await expect(
      modeTablist.getByRole("tab", { name: "Visual" }),
    ).toBeVisible();
  });
});
