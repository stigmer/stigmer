import { test, expect } from "../../fixtures";

/**
 * The dashboard's operational overview renders its summary for the active
 * organization. In an organization with no activity every counter reads
 * zero and every panel says it has nothing to show, rather than failing or
 * showing another organization's numbers.
 */
test.describe("Dashboard", () => {
  test("renders the operational overview heading and description", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Operational overview across your organization.")).toBeVisible();
  });

  test("an organization with no activity shows zero counters and empty panels", async ({
    page,
    freshOrg,
  }) => {
    await page.goto("/dashboard");
    // The pin took: these numbers are the fresh organization's.
    await expect(page.getByRole("button", { name: "Organization menu" })).toContainText(
      freshOrg.slug,
      { timeout: 15_000 },
    );

    const summary = page.getByRole("region", { name: "Platform dashboard" });
    await expect(summary).toBeVisible({ timeout: 15_000 });
    for (const counter of ["Active", "Completed", "Failed"]) {
      await expect(
        summary.getByText(counter, { exact: true }).locator("xpath=following-sibling::*[1]"),
      ).toHaveText("0");
    }
    await expect(summary.getByText("$0.00")).toBeVisible();
    await expect(summary.getByText("No approvals pending")).toBeVisible();
    await expect(summary.getByText("No recent failures")).toBeVisible();
    await expect(page.getByText("No cost data available")).toBeVisible();
    await expect(page.getByText("No execution data available")).toBeVisible();
  });
});
