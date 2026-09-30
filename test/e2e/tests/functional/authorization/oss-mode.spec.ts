import { test, expect } from "@playwright/test";

/**
 * The open-source server's own authorization posture, where it says more
 * than the other specs: on a trusted-local server the operator is the
 * owner of every organization, and the members page lists exactly that.
 *
 * The rest of the posture is pinned where it lives: the members and
 * invitations sections in settings.spec.ts, blueprint and instance
 * visibility in blueprint-visibility.spec.ts and instance-visibility.spec.ts,
 * sharing in share-resource.spec.ts, the owner's actions in
 * permission-gate.spec.ts.
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
});
