import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { test, expect } from "../../../fixtures";
import { openManageAccessFromKebab, visibilityBadge } from "../../../helpers/access";

/**
 * Blueprint visibility, the General access axis of "Manage access".
 *
 * A blueprint (agent, workflow) is created at Organization visibility, the
 * blueprint default. Its detail header shows the level as a badge that opens
 * the Manage access dialog, and the dialog's General access control is where
 * the level changes: Private or Organization, never the retired public
 * level. A change is written to the server and the header follows it.
 *
 * Run against the open-source server, where the owner of a resource holds
 * this control in every edition (the audience permission). Each test seeds
 * its own resource, so nothing here depends on what the stack holds.
 */
test.describe("Blueprint visibility", () => {
  test.describe("Agent", () => {
    test("the header badge names the level and opens Manage access", async ({
      page,
      testAgent,
    }) => {
      await page.goto(`/library/agents/${testAgent.org}/${testAgent.slug}`);

      const badge = visibilityBadge(page);
      await expect(badge).toHaveText("Organization", { timeout: 15_000 });
      await badge.click();

      const dialog = page.getByRole("dialog", { name: "Manage access" });
      await expect(dialog.getByRole("heading", { name: "General access" })).toBeVisible();
    });

    test("the visibility control offers exactly Private and Organization", async ({
      page,
      testAgent,
    }) => {
      await page.goto(`/library/agents/${testAgent.org}/${testAgent.slug}`);
      const dialog = await openManageAccessFromKebab(page);

      const control = dialog.getByRole("button", { name: "Resource visibility: Organization" });
      await expect(control).toBeEnabled();
      await control.click();

      const listbox = page.getByRole("listbox", { name: "Resource visibility" });
      await expect(listbox).toBeVisible();
      // toBeVisible checks the box, not what covers it: a trial click checks
      // that the option really receives the pointer (it once did not: #1509).
      await listbox.getByRole("option", { name: /^Private/ }).click({ trial: true });
      const options = listbox.getByRole("option");
      await expect(options).toHaveCount(2);
      await expect(options.nth(0)).toHaveAccessibleName(/^Private/);
      await expect(options.nth(1)).toHaveAccessibleName(/^Organization/);
      await expect(page.getByRole("option", { name: /^Public/ })).toHaveCount(0);
    });

    test("choosing Private writes it to the server and the header follows", async ({
      page,
      testAgent,
      stigmerClient,
    }) => {
      await page.goto(`/library/agents/${testAgent.org}/${testAgent.slug}`);
      const dialog = await openManageAccessFromKebab(page);

      await dialog.getByRole("button", { name: "Resource visibility: Organization" }).click();
      await page.getByRole("option", { name: /^Private/ }).click();

      await expect(dialog.getByRole("button", { name: "Resource visibility: Private" })).toBeVisible({
        timeout: 15_000,
      });
      await dialog.getByRole("button", { name: "Done" }).click();
      await expect(visibilityBadge(page)).toHaveText("Private");

      const stored = await stigmerClient.agent.get(testAgent.id);
      expect(stored.metadata?.visibility).toBe(ApiResourceVisibility.visibility_private);
    });
  });

  test.describe("Workflow", () => {
    test("the workflow's Manage access dialog carries the same General access control", async ({
      page,
      testWorkflow,
    }) => {
      await page.goto(`/library/workflows/${testWorkflow.org}/${testWorkflow.slug}`);
      await expect(visibilityBadge(page)).toHaveText("Organization", { timeout: 15_000 });

      const dialog = await openManageAccessFromKebab(page);
      await expect(dialog.getByRole("heading", { name: "General access" })).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "Resource visibility: Organization" }),
      ).toBeEnabled();
    });
  });
});
