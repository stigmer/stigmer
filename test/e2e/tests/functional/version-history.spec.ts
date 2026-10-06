import { test, expect } from "../../fixtures";
import { createTestAgent, createTestSkill } from "../../fixtures/seed-helpers";
import { toAgentUpdateInput } from "@stigmer/sdk";

/**
 * Version-history UX coverage.
 *
 * Validates the user-visible symptom that motivated the versioning fixes:
 * "I push multiple times but only ever see one version." These tests seed
 * real version history through the SDK and assert the detail-page timeline
 * renders one entry per distinct content hash (and none for idempotent
 * re-pushes and unchanged updates), for agents and skills.
 */
test.describe("Version history timeline", () => {
  test("agent: a changed update shows two entries, the tab counts them, and an older one diffs its instructions", async ({
    page,
    stigmerClient,
  }) => {
    const agent = await createTestAgent(stigmerClient, {
      instructions: "Review pull requests and keep every comment short.",
    });

    try {
      const fetched = await stigmerClient.agent.get(agent.id);
      await stigmerClient.agent.update({
        ...toAgentUpdateInput(fetched),
        instructions: "Review pull requests and keep every comment short.\nAlways flag missing tests.",
      });
      // An unchanged update records no version.
      await stigmerClient.agent.update(toAgentUpdateInput(await stigmerClient.agent.get(agent.id)));

      await page.goto(`/library/agents/${agent.org}/${agent.slug}`);
      await page.waitForLoadState("networkidle");

      const tab = page.getByRole("tab", { name: /Versions/ });
      await expect(tab).toContainText("2", { timeout: 15_000 });
      await tab.click();

      const timeline = page.getByRole("list", { name: "Version history" });
      await expect(timeline).toBeVisible({ timeout: 15_000 });
      const entries = timeline.getByRole("listitem");
      await expect(entries).toHaveCount(2);

      await entries.nth(1).getByRole("button").first().click();
      await expect(page.getByText(/Comparing/)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("cell", { name: "Always flag missing tests." })).toBeVisible();
    } finally {
      await agent.cleanup();
    }
  });

  test("skill: a changed push shows two entries and opens the diff dialog", async ({
    page,
    stigmerClient,
  }) => {
    const skill = await createTestSkill(stigmerClient, {
      body: "Initial version body.",
    });

    try {
      // Push changed content → a second, distinct version.
      await skill.pushUpdate("Updated version body with different content.");

      await page.goto(`/library/skills/${skill.org}/${skill.slug}`);
      await page.waitForLoadState("networkidle");

      await page.getByRole("tab", { name: /Versions/ }).click();

      const timeline = page.getByRole("list", { name: "Version history" });
      await expect(timeline).toBeVisible({ timeout: 15_000 });

      const entries = timeline.getByRole("listitem");
      await expect(entries).toHaveCount(2);

      // Skill timeline uses compare mode: selecting two entries opens the diff.
      await entries.nth(0).getByRole("button").first().click();
      await entries.nth(1).getByRole("button").first().click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 });
    } finally {
      await skill.cleanup();
    }
  });
});
