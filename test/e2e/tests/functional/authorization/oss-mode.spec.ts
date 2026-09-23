import { test, expect } from "@playwright/test";

/**
 * OSS Mode Authorization Tests
 *
 * Verifies the authorization UI's open-source posture when running
 * against the OSS server edition (no OpenFGA; the IamPolicy row half is
 * served by open source since 20260913.01).
 *
 * Key behaviors in OSS:
 * - The visibility control for blueprints (private/organization) remains
 *   visible (it updates metadata in SQLite without FGA)
 * - The organization members page lists the organization's roles — on a
 *   trusted-local server the operator is the owner of every organization
 * - The invitations page shows CloudFeatureNotice (invitations stay an
 *   Enterprise/Cloud kind)
 * - Per-person sharing is not offered: an agent's Manage access dialog
 *   says so instead of listing people, and has no "Add people" control
 * - Instance visibility selector is absent (requires FGA for enforcement)
 * - All actions (edit, delete, run) are always enabled (no permission
 *   checks until per-person authorization lands)
 *
 * Prerequisites:
 * - Running against OSS stigmer-server (not cloud)
 */

test.describe("OSS Mode - Authorization UI", () => {
  test.skip(
    !!process.env.STIGMER_E2E_CLOUD,
    "These tests validate OSS-specific behavior",
  );

  test("settings/members lists the operator as the organization's owner", async ({
    page,
  }) => {
    await page.goto("/settings/members");
    await page.waitForLoadState("networkidle");

    // The row half of IAM policies is served by open source: the page
    // renders the members panel, never a cloud-only notice.
    await expect(page.getByText(/not available in local mode/i)).not.toBeVisible();
    const members = page.getByRole("list", { name: "Organization members" });
    await expect(members).toBeVisible();
    await expect(members.getByRole("listitem")).toHaveCount(1);
    await expect(members.getByText("Owner", { exact: true })).toBeVisible();
  });

  test("settings/invitations shows cloud feature notice", async ({ page }) => {
    await page.goto("/settings/invitations");
    await page.waitForLoadState("networkidle");

    // The notice itself, not the sidebar's "Local mode" label (which the
    // looser /local mode/ match also caught, a strict-mode violation).
    const notice = page.getByText(/Invitations are not available in local mode/i);
    await expect(notice).toBeVisible();
  });

  test("agent visibility is editable in the Manage access dialog in OSS", async ({
    page,
  }) => {
    await page.goto("/library/agents");
    await page.waitForLoadState("networkidle");

    const firstAgent = page.locator('[role="listitem"]').first();
    if (await firstAgent.isVisible()) {
      await firstAgent.click();
      await page.waitForLoadState("networkidle");

      // Visibility editing moved into the unified Manage access dialog; the
      // header now shows a read-only badge. Visibility still works in OSS
      // (metadata-only, no FGA), so the dialog's General access control is
      // present and editable.
      const kebab = page.getByRole("button", { name: "More actions" });
      await kebab.click();
      await page.getByRole("menuitem", { name: "Manage access" }).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText("General access")).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: /Resource visibility/i }),
      ).toBeVisible();

      // Per-person sharing is what the Enterprise and Cloud editions add:
      // open source says so in one sentence and offers no grant control.
      await expect(
        dialog.getByText(/does not share agents with individual people/i),
      ).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: /Add people/ }),
      ).not.toBeVisible();
    }
  });

  test("agent detail does NOT have a bespoke share button in OSS", async ({
    page,
  }) => {
    await page.goto("/library/agents");
    await page.waitForLoadState("networkidle");

    const firstAgent = page.locator('[role="listitem"]').first();
    if (await firstAgent.isVisible()) {
      await firstAgent.click();
      await page.waitForLoadState("networkidle");

      // The legacy per-surface "Share" button is gone everywhere — access is
      // managed through the one Manage access dialog. No literal Share control
      // should exist on the detail page.
      const shareButton = page.getByRole("button", { name: /^share$/i });
      await expect(shareButton).not.toBeVisible();
    }
  });

  test("no instance visibility selector in OSS", async ({ page }) => {
    await page.goto("/library/workflows");
    await page.waitForLoadState("networkidle");

    const firstWorkflow = page
      .locator('[role="listitem"]')
      .first();
    if (await firstWorkflow.isVisible()) {
      await firstWorkflow.click();
      await page.waitForLoadState("networkidle");

      // Instance visibility selector should NOT appear in OSS
      // (requires FGA for enforcement)
      const instanceSelector = page.getByRole("radiogroup", {
        name: "Instance visibility",
      });
      await expect(instanceSelector).not.toBeVisible();
    }
  });
});
