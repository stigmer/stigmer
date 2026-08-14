import { test, expect } from "../../fixtures";
import { ensureDefaultOrg } from "../../fixtures/seed-helpers";
import { assertNoErrorBoundary } from "../../helpers/navigation";
import type { Page } from "@playwright/test";

/**
 * Share flow on the agent detail page, anchored to the Shares-tab surface
 * (stigmer#744): the Share action is pure navigation to the Shares tab,
 * where each share is its own channel — created through the Create-share
 * dialog, listed with its chat link, and deleted through the row's
 * actions menu.
 *
 * Runs against the OSS stack, where permission checks degrade permissive
 * — the Share action and every share affordance are visible to the
 * single local user.
 */

async function openAgentDetail(page: Page, org: string, slug: string) {
  await page.goto(`/library/agents/${org}/${slug}`);
  await expect(page.getByRole("heading", { name: slug })).toBeVisible({
    timeout: 15_000,
  });
  await assertNoErrorBoundary(page);
}

// The Share action navigates to the Shares tab; a fresh fixture agent has
// no shares, so it lands on the first-use empty state.
async function openSharesTab(page: Page) {
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Share" }).click();
}

// Creates a share through the dialog. The form prefills name and slug from
// the agent; the slug is overridden because share slugs live in the org's
// resource namespace, so reusing the agent's own slug would collide.
async function createShare(page: Page, shareSlug: string) {
  await page.getByRole("button", { name: "Create share" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Slug").fill(shareSlug);
  await dialog.getByRole("button", { name: "Create share" }).click();

  // Success flips the dialog from the create form to the share editor.
  await expect(page.getByText("Share created — the link is live")).toBeVisible(
    { timeout: 10_000 },
  );
  await dialog.getByRole("button", { name: "Done" }).click();
}

// Deletes the share via the row's actions menu, confirming the destructive
// dialog, and waits for the list to return to the empty state — leaving
// the fixture agent unshared for other tests.
async function deleteShare(page: Page, shareName: string) {
  await page.getByRole("button", { name: `Actions for ${shareName}` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();

  const confirmDialog = page.getByRole("dialog", { name: "Delete share?" });
  await confirmDialog.getByRole("button", { name: "Delete" }).click();

  await expect(page.getByText("Share deleted")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText("No shares yet")).toBeVisible({
    timeout: 10_000,
  });
}

test.describe("Share agent flow", () => {
  // The row's copy affordance writes through navigator.clipboard, which
  // automated Chromium only allows with an explicit permission grant.
  test.use({ permissions: ["clipboard-write"] });

  // A fresh OSS stack has no organizations, so the OrgGate would block
  // every route on the onboarding screen. Idempotent — a no-op when the
  // stack is reused and the org already exists.
  test.beforeAll(async ({ stigmerClient }) => {
    await ensureDefaultOrg(stigmerClient);
  });

  test("create a share from the Shares tab, see the live link, copy it, delete it", async ({
    page,
    testAgent,
  }) => {
    await openAgentDetail(page, testAgent.org, testAgent.slug);
    await openSharesTab(page);

    // Fresh agent: the Shares tab opens on the first-use empty state.
    await expect(page.getByText("No shares yet")).toBeVisible({
      timeout: 10_000,
    });

    const shareSlug = `${testAgent.slug}-share`;
    await createShare(page, shareSlug);

    // The list shows the share with its chat link (name stays prefilled
    // from the agent, so the row is addressed by the agent's name).
    const expectedPath = `/chat/${testAgent.org}/${shareSlug}`;
    await expect(page.getByText(expectedPath)).toBeVisible({
      timeout: 10_000,
    });

    // Copy the link (clipboard-permission-free assertion: the toast
    // confirms; the copied URL additionally carries the link token).
    await page
      .getByRole("button", { name: `Copy link for ${testAgent.slug}` })
      .click();
    await expect(page.getByText("Link copied")).toBeVisible({
      timeout: 5_000,
    });

    await deleteShare(page, testAgent.slug);
  });

  test("a created share persists across a page reload", async ({
    page,
    testAgent,
  }) => {
    await openAgentDetail(page, testAgent.org, testAgent.slug);
    await openSharesTab(page);
    await expect(page.getByText("No shares yet")).toBeVisible({
      timeout: 10_000,
    });

    const shareSlug = `${testAgent.slug}-share`;
    await createShare(page, shareSlug);

    // Reload and come back through the same entry path — the share is a
    // server-side resource, so it must survive the full remount.
    await openAgentDetail(page, testAgent.org, testAgent.slug);
    await openSharesTab(page);
    await expect(
      page.getByText(`/chat/${testAgent.org}/${shareSlug}`),
    ).toBeVisible({ timeout: 10_000 });

    await deleteShare(page, testAgent.slug);
  });
});
