import { test, expect } from "../../fixtures";
import { createTestOrg, type TestOrgResult } from "../../fixtures/seed-helpers";

/**
 * A parent organization's profile page opens each of its children: the
 * Child organizations list gives every row an Open action, which makes the
 * child the active organization and lands on the dashboard, and the child
 * stays active across a reload.
 *
 * This lane runs without sign-in, where every organization is the caller's
 * own, so the child is also in the organization menu's list here; that a
 * parent's admin with no role in the child keeps it across reloads is
 * pinned by the React SDK's OrgProvider suite. The case seeds a parent and
 * a child of its own, and makes the parent active once, before the first
 * page loads (an init script that writes only when nothing is remembered,
 * so the reload keeps what the console chose).
 */
test.describe("Child organizations: open a child from its parent's profile", () => {
  test("Open makes the child active, lands on the dashboard, and survives a reload", async ({
    page,
    stigmerClient,
  }) => {
    test.setTimeout(90_000);
    const parent: TestOrgResult = await createTestOrg(stigmerClient);
    const childSlug = `${parent.slug}-child`;
    let childId = "";
    try {
      const child = await stigmerClient.organization.create({
        name: childSlug,
        slug: childSlug,
        parentOrg: parent.id,
      });
      childId = child.metadata!.id;

      await page.addInitScript((id) => {
        if (!localStorage.getItem("stigmer:activeOrg")) {
          localStorage.setItem("stigmer:activeOrg", id);
        }
      }, parent.id);

      const orgMenu = page.getByRole("button", { name: "Organization menu" });
      await page.goto("/settings/org-profile");
      await expect(orgMenu).toContainText(parent.slug, { timeout: 15_000 });

      const children = page.getByRole("region", { name: "Child organizations" });
      await expect(children.getByText(childSlug, { exact: true }).first()).toBeVisible({
        timeout: 15_000,
      });
      await children.getByRole("button", { name: `Open ${childSlug}` }).click();

      await expect(page).toHaveURL(/\/dashboard\/?$/, { timeout: 15_000 });
      await expect(orgMenu).toContainText(childSlug, { timeout: 15_000 });
      expect(await page.evaluate(() => localStorage.getItem("stigmer:activeOrg"))).toBe(childId);

      await page.reload();
      await expect(orgMenu).toContainText(childSlug, { timeout: 15_000 });
      expect(await page.evaluate(() => localStorage.getItem("stigmer:activeOrg"))).toBe(childId);
    } finally {
      // A parent with a live child refuses its own delete: the child goes first.
      if (childId) await stigmerClient.organization.delete(childId).catch(() => {});
      await parent.cleanup();
    }
  });
});
