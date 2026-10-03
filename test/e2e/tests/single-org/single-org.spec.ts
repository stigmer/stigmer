import { test, expect } from "../../fixtures";
import { SINGLE_ORG_STACK } from "../../fixtures/single-org";

/**
 * The console on the open-source edition as a laptop runs it: a server that
 * holds one organization, which it made at its first start and fills into
 * every request that names none (getServerInfo answers `single_org`).
 *
 * What a person sees, end to end:
 * - the library opens straight away: no create-an-organization onboarding,
 *   and no organization switcher in the sidebar;
 * - settings name no organization: the first group is "General", with no
 *   organization profile page, and no "Organization" group;
 * - an agent created with no organization opens at its console URL;
 * - the operator owns the organization (the members page says Owner).
 *
 * Stack shape: `STIGMER_E2E_SINGLE_ORG=1` (fixtures/single-org.ts): the shipped
 * server entry, trusted-local, nothing seeded. Every other project runs
 * against the library entry, which holds several organizations.
 */

test.describe("the console on a server that holds one organization", () => {
  test.skip(
    !SINGLE_ORG_STACK,
    "needs the single-organization stack shape — run with STIGMER_E2E_SINGLE_ORG=1",
  );

  test("the library opens with no onboarding and no organization switcher", async ({ page }) => {
    await page.goto("/library/agents");
    await expect(page.getByRole("heading", { name: "Agents" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Welcome to Stigmer")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Organization menu" })).toHaveCount(0);
  });

  test("settings name no organization", async ({ page }) => {
    await page.goto("/settings/members");
    await expect(page.getByText("General", { exact: true }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole("link", { name: "Org Profile" })).toHaveCount(0);
    await expect(page.getByText("Organization", { exact: true })).toHaveCount(0);
  });

  test("an agent created with no organization opens at its URL", async ({ page, stigmerClient }) => {
    const name = `e2e-single-org-${Date.now()}`;
    const agent = await stigmerClient.agent.create({
      name,
      org: "",
      instructions: "An agent the single-organization journey opens.",
    });
    const org = agent.metadata?.org ?? "";
    const slug = agent.metadata?.slug ?? "";
    expect(org).not.toBe("");

    try {
      await page.goto(`/library/agents/${org}/${slug}`);
      await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
    } finally {
      await stigmerClient.agent.delete(agent.metadata?.id ?? "");
    }
  });

  test("the operator owns the organization", async ({ page }) => {
    await page.goto("/settings/members");
    const members = page.getByRole("list", { name: "Organization members" });
    await expect(members).toBeVisible({ timeout: 15_000 });
    await expect(members.getByRole("listitem")).toHaveCount(1);
    await expect(members.getByText("Owner", { exact: true })).toBeVisible();
  });
});
