import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { test, expect } from "../../../fixtures";
import { createTestWorkflowInstance } from "../../../fixtures/seed-helpers";

/**
 * Instance visibility, on a workflow's Instances tab.
 *
 * An instance is created private (instances are personal kinds). Its row's
 * Visibility cell is a popover selector naming the level; it offers exactly
 * Private and Organization, never the retired public level, and escalating
 * to Organization asks for a light inline confirmation before it writes.
 *
 * Each test seeds its own workflow and instance. The selector is present on
 * the open-source server too: the level is stored and enforced without
 * OpenFGA.
 */
test.describe("Instance visibility", () => {
  test("a new instance shows Private and offers exactly Private and Organization", async ({
    page,
    testWorkflow,
    stigmerClient,
  }) => {
    const instance = await createTestWorkflowInstance(stigmerClient, testWorkflow);
    try {
      await page.goto(`/library/workflows/${testWorkflow.org}/${testWorkflow.slug}`);
      await page.getByRole("tab", { name: "Instances" }).click();

      const trigger = page.getByRole("button", { name: "Instance visibility: Private" });
      await expect(trigger).toBeVisible({ timeout: 15_000 });
      await trigger.click();

      const listbox = page.getByRole("listbox", { name: "Instance visibility" });
      await expect(listbox).toBeVisible();
      const options = listbox.getByRole("option");
      await expect(options).toHaveCount(2);
      await expect(options.nth(0)).toHaveAccessibleName(/^Private/);
      await expect(options.nth(1)).toHaveAccessibleName(/^Organization/);
      await expect(page.getByRole("option", { name: /^Public/ })).toHaveCount(0);
    } finally {
      await instance.cleanup();
    }
  });

  test("escalating to Organization asks first, then writes the level", async ({
    page,
    testWorkflow,
    stigmerClient,
  }) => {
    const instance = await createTestWorkflowInstance(stigmerClient, testWorkflow);
    try {
      await page.goto(`/library/workflows/${testWorkflow.org}/${testWorkflow.slug}`);
      await page.getByRole("tab", { name: "Instances" }).click();
      await page.getByRole("button", { name: "Instance visibility: Private" }).click();
      await page
        .getByRole("listbox", { name: "Instance visibility" })
        .getByRole("option", { name: /^Organization/ })
        .click();

      const confirm = page.getByRole("alert").filter({ hasText: "Make visible to all org members" });
      await expect(confirm).toBeVisible();
      await confirm.getByRole("button", { name: /confirm|make visible|yes/i }).first().click();

      await expect(
        page.getByRole("button", { name: "Instance visibility: Organization" }),
      ).toBeVisible({ timeout: 15_000 });
      const stored = await stigmerClient.workflowInstance.get(instance.id);
      expect(stored.metadata?.visibility).toBe(ApiResourceVisibility.visibility_org);
    } finally {
      await instance.cleanup();
    }
  });
});
