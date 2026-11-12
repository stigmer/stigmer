import { test, expect } from "../../fixtures";
import { SINGLE_ORG_STACK } from "../../fixtures/single-org";

/**
 * The console on the open-source edition as a laptop runs it: a server that
 * holds one organization, which it made at its first start and fills into
 * every request that names none (getServerInfo answers `single_org`).
 *
 * What a person sees, end to end:
 * - the first screen asks what their agent should do for their users, the
 *   question every edition asks a newcomer, with no organization screen
 *   before it (first in this file, so nothing has run on the stack yet);
 * - the journey reads the same: the dashboard's card "From first agent to
 *   your users" stands in the figures' place while nothing has run, and an
 *   example's agent offers its "Make it yours" tab, opened by its link;
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

  test("CON-06 the first screen is the newcomer's question, with no organization screen before it", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "What should your agent do for your users?" })).toBeVisible({
      timeout: 15_000,
    });
    for (const job of ["Variance report", "Ticket replies", "Contract check", "Invoice match"]) {
      await expect(page.getByRole("button", { name: job })).toBeVisible();
    }
    await expect(page.getByText("Welcome to Stigmer")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Organization menu" })).toHaveCount(0);
  });

  test("CON-08 the journey's card and the agent's Make it yours tab show as on every edition", async ({ page, stigmerClient }) => {
    await page.goto("/dashboard");
    const card = page.getByRole("region", { name: "From first agent to your users" });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText(/\b[0-5] of 6\b/);

    // An example's agent, made as the first question makes it.
    const agent = await stigmerClient.agent.create({
      name: "Variance Reporter",
      slug: "variance-reporter",
      org: "",
      instructions: "Flag each account more than 10% over or under budget. Save the report as variance-report.md.",
      disallowedTools: ["Bash"],
    });
    try {
      await page.goto(`/library/agents/${agent.metadata?.org ?? ""}/variance-reporter?tab=make-it-yours`);
      await expect(page.getByRole("tab", { name: "Make it yours", selected: true })).toBeVisible({ timeout: 15_000 });
      for (const act of ["Change what it does", "Try your own file", "Give it a skill"]) {
        await expect(page.getByRole("region", { name: act })).toBeVisible();
      }
    } finally {
      await stigmerClient.agent.delete(agent.metadata?.id ?? "");
    }
  });

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
