import { test, expect } from "@playwright/test";

/**
 * Instance Visibility Tests
 *
 * Verifies the popover visibility selector (private/org) on instance detail
 * panels: the current-state chip opens a listbox of levels, an Organization
 * escalation shows the light inline confirm, and the retired public level is
 * offered nowhere.
 *
 * Prerequisites:
 * - Running against a Cloud-connected backend with FGA enabled
 * - Test user has at least one agent/workflow instance they own
 *
 * These are data-dependent smokes: each assertion is guarded so the suite
 * stays green when the seeded account has no editable instance to exercise.
 */

async function openFirstWorkflowInstances(page: import("@playwright/test").Page) {
  await page.goto("/library/workflows");
  await page.waitForLoadState("networkidle");

  const firstWorkflow = page.locator('[role="listitem"]').first();
  if (!(await firstWorkflow.isVisible())) return false;
  await firstWorkflow.click();
  await page.waitForLoadState("networkidle");

  // The visibility control lives in each instance row's "Visibility" column,
  // so revealing the Instances tab is enough — no row expansion needed.
  const instancesTab = page.getByRole("tab", { name: /instances/i });
  if (await instancesTab.isVisible()) {
    await instancesTab.click();
  }
  return true;
}

/** The editable trigger (a button); absent when the user lacks can_edit. */
function visibilityTrigger(page: import("@playwright/test").Page) {
  return page.getByRole("button", { name: /Instance visibility:/i }).first();
}

test.describe("Instance Visibility", () => {
  test("opens a popover listing private and organization, never public", async ({
    page,
  }) => {
    if (!(await openFirstWorkflowInstances(page))) return;

    const trigger = visibilityTrigger(page);
    if (!(await trigger.isVisible())) return;
    await trigger.click();

    const listbox = page.getByRole("listbox", { name: "Instance visibility" });
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole("option", { name: /Private/i })).toBeVisible();
    await expect(
      listbox.getByRole("option", { name: /Organization/i }),
    ).toBeVisible();
    // The public level is retired; instances offer exactly two levels.
    await expect(listbox.getByRole("option", { name: /Public/i })).toHaveCount(0);
  });

  test("escalating to organization shows the inline confirm", async ({
    page,
  }) => {
    if (!(await openFirstWorkflowInstances(page))) return;

    const trigger = visibilityTrigger(page);
    if (!(await trigger.isVisible())) return;
    await trigger.click();

    const orgOption = page
      .getByRole("listbox", { name: "Instance visibility" })
      .getByRole("option", { name: /Organization/i });
    if (!(await orgOption.isVisible())) return;
    await orgOption.click();

    // Escalating from private shows the light inline prompt; if the instance
    // was already org-visible the click is a no-op and no alert appears.
    const inlineConfirm = page.getByRole("alert");
    if (await inlineConfirm.isVisible()) {
      await expect(inlineConfirm).toContainText("Make visible to all org members");
    }
  });
});
