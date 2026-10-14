import { create } from "@bufbuild/protobuf";
import { ListAgentSharesByAgentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/io_pb";
import { test, expect } from "../../fixtures";
import { ensureDefaultOrg } from "../../fixtures/seed-helpers";
import { assertNoErrorBoundary } from "../../helpers/navigation";
import type { Page } from "@playwright/test";
import type { Stigmer } from "@stigmer/sdk";

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

/**
 * The chat link the console shows for the agent's share with `shareSlug`:
 * `/chat/<share id>`, the id read back from the server. A link names only
 * the share, so no rename of its organization moves it.
 */
async function chatPathOf(
  client: Stigmer,
  agentId: string,
  shareSlug: string,
): Promise<string> {
  const shares = await client.agentShare.listByAgent(
    create(ListAgentSharesByAgentRequestSchema, { agentId }),
  );
  const share = shares.entries.find((s) => s.metadata?.slug === shareSlug);
  if (share === undefined) {
    throw new Error(`no share '${shareSlug}' on agent ${agentId}`);
  }
  return `/chat/${share.metadata!.id}`;
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
    stigmerClient,
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
    // from the agent, so the row is addressed by the agent's name). The
    // link names the share by its id, which no rename or later holder of
    // the organization's slug can move.
    const expectedPath = await chatPathOf(
      stigmerClient,
      testAgent.id,
      shareSlug,
    );
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
    stigmerClient,
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
      page.getByText(
        await chatPathOf(stigmerClient, testAgent.id, shareSlug),
      ),
    ).toBeVisible({ timeout: 10_000 });

    await deleteShare(page, testAgent.slug);
  });

  test("rename the agent from its detail view: the old library URL moves to the new one, and the share's chat link still answers", async ({
    page,
    testAgent,
    stigmerClient,
  }) => {
    await openAgentDetail(page, testAgent.org, testAgent.slug);
    await openSharesTab(page);
    await expect(page.getByText("No shares yet")).toBeVisible({
      timeout: 10_000,
    });
    const shareSlug = `${testAgent.slug}-share`;
    await createShare(page, shareSlug);
    const chatPath = await chatPathOf(stigmerClient, testAgent.id, shareSlug);

    // Rename from the Overview's slug field (the local user may delete the
    // agent, so the field is offered). The address follows in place.
    const renamed = `${testAgent.slug}-renamed`;
    await page.getByRole("tab", { name: "Overview" }).click();
    await page.getByLabel("Slug").fill(renamed);
    await page.getByRole("button", { name: "Rename" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/library/agents/[^/]+/${renamed}$`),
      { timeout: 15_000 },
    );

    // A bookmark to the old address opens the agent, and the address
    // becomes the new one.
    await page.goto(`/library/agents/${testAgent.org}/${testAgent.slug}`);
    await expect(page.getByRole("heading", { name: testAgent.slug })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveURL(
      new RegExp(`/library/agents/[^/]+/${renamed}$`),
      { timeout: 15_000 },
    );
    await assertNoErrorBoundary(page);

    // The chat link names the share by its id, so it still answers: the
    // server resolves it to the renamed agent, and the page boots (on the
    // open-source stack its guest sign-in is unimplemented, so it shows
    // its error state rather than the agent; the embed spec's posture).
    // The console's share is for the organization's members, so the
    // member lane reads it (the anonymous lane answers only a public one).
    const shareId = chatPath.replace("/chat/", "");
    const profile = await stigmerClient.agentShare.getSharedProfileForMember(shareId);
    expect(profile.name).toBe(testAgent.slug);
    await page.goto(chatPath);
    await expect(
      page.getByText(new RegExp(`${testAgent.slug}|Something went wrong`)).first(),
    ).toBeVisible({ timeout: 20_000 });

    // The page's heading is the agent's name, which a rename keeps.
    await page.goto(`/library/agents/${testAgent.org}/${renamed}`);
    await expect(page.getByRole("heading", { name: testAgent.slug })).toBeVisible({
      timeout: 15_000,
    });
    await openSharesTab(page);
    await deleteShare(page, testAgent.slug);
  });
});
