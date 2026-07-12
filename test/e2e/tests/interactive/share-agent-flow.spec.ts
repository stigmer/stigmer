import { test, expect } from "../../fixtures";
import { ensureDefaultOrg } from "../../fixtures/seed-helpers";
import { assertNoErrorBoundary } from "../../helpers/navigation";
import type { Page } from "@playwright/test";

/**
 * Share flow on the agent detail page: open the Share dialog from the
 * actions menu, toggle sharing on, verify the public chat link renders,
 * copy it, and toggle sharing back off.
 *
 * Runs against the OSS stack, where permission checks degrade permissive
 * — the Share action is always visible to the single local user.
 */

async function openAgentDetail(page: Page, org: string, slug: string) {
  await page.goto(`/library/agents/${org}/${slug}`);
  await expect(page.getByRole("heading", { name: slug })).toBeVisible({
    timeout: 15_000,
  });
  await assertNoErrorBoundary(page);
}

async function openShareDialog(page: Page) {
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Share" }).click();
  await expect(
    page.getByRole("dialog").getByText("Anyone with the link can chat"),
  ).toBeVisible({ timeout: 10_000 });
}

test.describe("Share agent flow", () => {
  // A fresh OSS stack has no organizations, so the OrgGate would block
  // every route on the onboarding screen. Idempotent — a no-op when the
  // stack is reused and the org already exists.
  test.beforeAll(async ({ stigmerClient }) => {
    await ensureDefaultOrg(stigmerClient);
  });

  test("toggle sharing on, see the link, copy it, toggle off", async ({
    page,
    testAgent,
  }) => {
    await openAgentDetail(page, testAgent.org, testAgent.slug);
    await openShareDialog(page);

    const dialog = page.getByRole("dialog");
    const shareSwitch = dialog.getByRole("switch");

    // Fresh agent: sharing starts disabled.
    await expect(shareSwitch).toHaveAttribute("aria-checked", "false");

    // Enable sharing — persisted by creating the canonical AgentShare
    // (agentShare.apply) against the real server.
    await shareSwitch.click();
    await expect(shareSwitch).toHaveAttribute("aria-checked", "true", {
      timeout: 10_000,
    });

    // The public chat link renders for this agent.
    const expectedPath = `/chat/${testAgent.org}/${testAgent.slug}`;
    await expect(dialog.getByText(expectedPath)).toBeVisible();

    // Copy the link (clipboard-permission-free assertion: the toast confirms).
    await dialog.getByRole("button", { name: "Copy" }).first().click();
    await expect(page.getByText("Link copied")).toBeVisible({ timeout: 5_000 });

    // Toggle sharing back off.
    await shareSwitch.click();
    await expect(shareSwitch).toHaveAttribute("aria-checked", "false", {
      timeout: 10_000,
    });
  });

  test("sharing state persists across a dialog reopen", async ({
    page,
    testAgent,
  }) => {
    await openAgentDetail(page, testAgent.org, testAgent.slug);
    await openShareDialog(page);

    const dialog = page.getByRole("dialog");
    const shareSwitch = dialog.getByRole("switch");

    await shareSwitch.click();
    await expect(shareSwitch).toHaveAttribute("aria-checked", "true", {
      timeout: 10_000,
    });

    // Close and reopen — the persisted state must survive the remount.
    await dialog.getByRole("button", { name: "Done" }).click();
    await openShareDialog(page);
    await expect(page.getByRole("dialog").getByRole("switch")).toHaveAttribute(
      "aria-checked",
      "true",
      { timeout: 10_000 },
    );

    // Leave the fixture unshared for other tests.
    await page.getByRole("dialog").getByRole("switch").click();
    await expect(page.getByRole("dialog").getByRole("switch")).toHaveAttribute(
      "aria-checked",
      "false",
      { timeout: 10_000 },
    );
  });
});
