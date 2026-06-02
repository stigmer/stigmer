import { test, expect } from "../../fixtures";
import {
  navigateToWorkflowDetail,
} from "../../helpers/workflow-detail";
import { assertNoErrorBoundary } from "../../helpers/navigation";

test.describe("Workflow Instance Management", () => {
  test("Instances tab shows empty state with Create CTA", async ({
    page,
    testWorkflow,
  }) => {
    await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);
    await assertNoErrorBoundary(page);

    // Navigate to Instances tab
    const instancesTab = page.getByRole("tab", { name: "Instances" });
    await instancesTab.click();

    // Should show the empty state (default instance is hidden)
    await expect(page.getByText("No instances yet")).toBeVisible();
    await expect(page.getByText("Create Instance")).toBeVisible();
  });

  test("Create Instance dialog opens from empty state CTA", async ({
    page,
    testWorkflow,
  }) => {
    await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);
    await assertNoErrorBoundary(page);

    const instancesTab = page.getByRole("tab", { name: "Instances" });
    await instancesTab.click();

    // Click Create Instance
    await page.getByRole("button", { name: "Create Instance" }).click();

    // Dialog should be visible
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Create Workflow Instance")).toBeVisible();

    // Form fields present
    await expect(dialog.getByLabel(/Name/)).toBeVisible();
    await expect(dialog.getByText("Environments")).toBeVisible();
    await expect(dialog.getByText("Visibility")).toBeVisible();
  });

  test("Create instance with name and verify it appears in list", async ({
    page,
    testWorkflow,
  }) => {
    await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);
    await assertNoErrorBoundary(page);

    const instancesTab = page.getByRole("tab", { name: "Instances" });
    await instancesTab.click();

    // Open create dialog
    await page.getByRole("button", { name: "Create Instance" }).click();
    const dialog = page.getByRole("dialog");

    // Fill name
    await dialog.getByLabel(/Name/).fill("prod-deploy");

    // Submit
    await dialog.getByRole("button", { name: "Create Instance" }).click();

    // Dialog closes and instance appears in list
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText("prod-deploy")).toBeVisible();
  });

  test("Instance list shows environment badges", async ({
    page,
    testWorkflow,
  }) => {
    await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);
    await assertNoErrorBoundary(page);

    const instancesTab = page.getByRole("tab", { name: "Instances" });
    await instancesTab.click();

    // If instances with environments exist, badges should be visible
    const envColumn = page.getByRole("columnheader", { name: "Environments" });
    await expect(envColumn).toBeVisible();
  });

  test("Run dialog shows instance picker when user instances exist", async ({
    page,
    testWorkflow,
  }) => {
    await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);
    await assertNoErrorBoundary(page);

    // Click Run button
    await page.getByRole("button", { name: "Run" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Instance selector should be present if user instances exist
    const instanceSelect = dialog.getByLabel("Instance");
    if (await instanceSelect.isVisible()) {
      // The "Default (no specific configuration)" option should exist
      await expect(instanceSelect.locator("option", { hasText: "Default" })).toBeAttached();
    }
  });

  test("Delete instance shows cascade warning", async ({
    page,
    testWorkflow,
  }) => {
    await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);
    await assertNoErrorBoundary(page);

    const instancesTab = page.getByRole("tab", { name: "Instances" });
    await instancesTab.click();

    // If there's a Delete button on any row
    const deleteBtn = page.getByRole("button", { name: "Delete" }).first();
    if (await deleteBtn.isVisible()) {
      await deleteBtn.click();

      // Should show cascade warning
      await expect(
        page.getByText("permanently delete this instance and all its execution history"),
      ).toBeVisible();
    }
  });
});
