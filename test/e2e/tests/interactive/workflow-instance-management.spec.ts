import type { Page } from "@playwright/test";
import { test, expect } from "../../fixtures";
import {
  navigateToWorkflowDetail,
  openRunDialog,
} from "../../helpers/workflow-detail";
import { assertNoErrorBoundary } from "../../helpers/navigation";

// Locator discipline for this page: the CTA is "Create instance"
// (lowercase i), while TWO mounted-but-closed native <dialog>s carry
// disabled "Create Instance" submit buttons — and getByRole's
// case-insensitive name matching makes a bare "Create Instance" locator
// collide with all of them. Interactions go through the visible CTA and
// the OPEN dialog only.

async function openInstancesTab(page: Page): Promise<void> {
  await page.getByRole("tab", { name: "Instances" }).click();
}

/** Opens the create dialog, fills the name, submits, waits for the row. */
async function createInstance(page: Page, name: string): Promise<void> {
  await page
    .getByRole("button", { name: "Create instance" })
    .filter({ visible: true })
    .click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/^Name/).fill(name);
  await dialog.getByRole("button", { name: "Create Instance" }).click();

  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("cell", { name })).toBeVisible({
    timeout: 10_000,
  });
}

test.describe("Workflow Instance Management", () => {
  test("Instances tab shows empty state with Create CTA", async ({
    page,
    testWorkflow,
  }) => {
    await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);
    await assertNoErrorBoundary(page);

    await openInstancesTab(page);

    // Empty state (the system-managed default instance is hidden)
    await expect(page.getByText("No instances yet")).toBeVisible();
    await expect(
      page
        .getByRole("button", { name: "Create instance" })
        .filter({ visible: true }),
    ).toBeVisible();
  });

  test("Create Instance dialog opens from empty state CTA", async ({
    page,
    testWorkflow,
  }) => {
    await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);
    await assertNoErrorBoundary(page);

    await openInstancesTab(page);

    await page
      .getByRole("button", { name: "Create instance" })
      .filter({ visible: true })
      .click();

    // Only the OPEN native dialog is in the accessibility tree.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Create Workflow Instance")).toBeVisible();

    // Form fields present ("Environments" appears as both the section
    // label and inside the picker's helper copy — assert the first)
    await expect(dialog.getByLabel(/^Name/)).toBeVisible();
    await expect(dialog.getByText("Environments").first()).toBeVisible();
    await expect(dialog.getByText("Visibility").first()).toBeVisible();
  });

  test("created instance appears in the list with environment column", async ({
    page,
    testWorkflow,
  }) => {
    await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);
    await assertNoErrorBoundary(page);

    await openInstancesTab(page);
    await createInstance(page, "prod-deploy");

    // The table replaces the empty state — with its environment column.
    // (The empty state renders no table, so this only holds after create.)
    await expect(
      page.getByRole("columnheader", { name: "Environments" }),
    ).toBeVisible();
  });

  test("Run dialog shows instance picker when user instances exist", async ({
    page,
    testWorkflow,
  }) => {
    await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);
    await assertNoErrorBoundary(page);

    await openInstancesTab(page);
    await createInstance(page, "picker-instance");

    await openRunDialog(page);
    const dialog = page.getByRole("dialog");

    // With a user instance present, the picker must offer the created
    // instance alongside the "Default" option.
    const instanceSelect = dialog.getByLabel("Instance");
    await expect(instanceSelect).toBeVisible();
    await expect(
      instanceSelect.locator("option", { hasText: "Default" }),
    ).toBeAttached();
    await expect(
      instanceSelect.locator("option", { hasText: "picker-instance" }),
    ).toBeAttached();
  });

  test("Delete instance shows cascade warning", async ({
    page,
    testWorkflow,
  }) => {
    // The SDK's row kebab (Run/Delete + cascade confirm) exists, but
    // neither client app wires onInstanceRunClick/onInstanceDeleteClick —
    // the Actions column renders empty cells, so this promise is
    // unreachable in the product today. The assertion below is ready;
    // un-fixme when the wiring lands.
    test.fixme(true, "instance row actions unwired in both client apps — stigmer/stigmer#582");

    await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);
    await assertNoErrorBoundary(page);

    await openInstancesTab(page);
    await createInstance(page, "doomed-instance");

    // Row actions live in a per-row overflow (kebab) menu.
    await page
      .getByRole("button", { name: "Actions for doomed-instance" })
      .click();
    await page.getByRole("menuitem", { name: "Delete" }).click();

    // Should show cascade warning
    await expect(
      page.getByText(
        "permanently delete this instance and all its execution history",
      ),
    ).toBeVisible();
  });
});
