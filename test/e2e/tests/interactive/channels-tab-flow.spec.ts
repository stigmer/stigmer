import { create } from "@bufbuild/protobuf";
import { ListChannelsByAgentRequestSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/io_pb";
import { test, expect } from "../../fixtures";
import { ensureDefaultOrg } from "../../fixtures/seed-helpers";
import { assertNoErrorBoundary } from "../../helpers/navigation";
import type { Page } from "@playwright/test";
import type { Stigmer } from "@stigmer/client";

/**
 * An agent's Channels tab: its chat links, Slack and WhatsApp channels in
 * one list, added through one affordance. A chat link is created through
 * the chat-link dialog, listed on its card with its link, paused with the
 * card's switch and deleted through the card's menu. The agent's own menu
 * offers Manage access and no Share item: "share" means giving access.
 *
 * Runs against the OSS stack, where permission checks degrade permissive
 * (every affordance is visible to the single local user) and vendor
 * installs are unavailable, so Slack and WhatsApp say they need Stigmer
 * Cloud while a chat link works.
 */

async function openAgentDetail(page: Page, org: string, slug: string) {
  await page.goto(`/library/agents/${org}/${slug}`);
  await expect(page.getByRole("heading", { name: slug })).toBeVisible({
    timeout: 15_000,
  });
  await assertNoErrorBoundary(page);
}

async function openChannelsTab(page: Page) {
  await page.getByRole("tab", { name: "Channels" }).click();
}

// Fills the chat-link dialog. The form prefills name and slug from the
// agent; the slug is overridden because channel slugs live in the org's
// namespace, so reusing the agent's own slug would collide.
async function fillChatLinkDialog(page: Page, linkSlug: string) {
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Create a chat link" }),
  ).toBeVisible({ timeout: 10_000 });
  await dialog.getByLabel("Slug").fill(linkSlug);
  await dialog.getByRole("button", { name: "Create chat link" }).click();

  // Success flips the dialog from the create form to the link's editor.
  await expect(
    page.getByText("Chat link created — the link is live"),
  ).toBeVisible({ timeout: 10_000 });
  await dialog.getByRole("button", { name: "Done" }).click();
}

// Creates a chat link from an empty Channels tab, through its own button.
async function createFirstChatLink(page: Page, linkSlug: string) {
  await page.getByRole("button", { name: "Create a chat link" }).click();
  await fillChatLinkDialog(page, linkSlug);
}

// Deletes the chat link through its card's menu, confirming the
// destructive dialog, and waits for the tab's empty state, leaving the
// fixture agent with no channels for other tests.
async function deleteChatLink(page: Page, linkName: string) {
  await page
    .getByRole("button", { name: `Actions for ${linkName}`, exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Delete" }).click();

  const confirmDialog = page.getByRole("dialog", { name: "Delete chat link?" });
  await confirmDialog.getByRole("button", { name: "Delete" }).click();

  await expect(page.getByText("Chat link deleted")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText("No channels yet")).toBeVisible({
    timeout: 10_000,
  });
}

/**
 * The chat link the console shows for the agent's channel with `linkSlug`:
 * `/chat/<channel id>`, the id read back from the server. A link names only
 * the channel, so no rename of its organization moves it.
 */
async function chatPathOf(
  client: Stigmer,
  agentId: string,
  linkSlug: string,
): Promise<string> {
  const channels = await client.channel.listByAgent(
    create(ListChannelsByAgentRequestSchema, { agentId }),
  );
  const channel = channels.entries.find((c) => c.metadata?.slug === linkSlug);
  if (channel === undefined) {
    throw new Error(`no channel '${linkSlug}' on agent ${agentId}`);
  }
  return `/chat/${channel.metadata!.id}`;
}

test.describe("Channels tab flow", () => {
  // The card's copy affordance writes through navigator.clipboard, which
  // automated Chromium only allows with an explicit permission grant.
  test.use({ permissions: ["clipboard-write"] });

  // A fresh OSS stack has no organizations, so the OrgGate would block
  // every route on the onboarding screen. Idempotent — a no-op when the
  // stack is reused and the org already exists.
  test.beforeAll(async ({ stigmerClient }) => {
    await ensureDefaultOrg(stigmerClient);
  });

  test("the agent's menu offers Manage access and no Share item", async ({
    page,
    testAgent,
  }) => {
    await openAgentDetail(page, testAgent.org, testAgent.slug);
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(
      page.getByRole("menuitem", { name: "Manage access" }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.getByRole("menuitem", { name: "Share", exact: true }),
    ).toHaveCount(0);
  });

  test("create a chat link from the Channels tab, see the live link, copy it, pause it, delete it", async ({
    page,
    testAgent,
    stigmerClient,
  }) => {
    await openAgentDetail(page, testAgent.org, testAgent.slug);
    await openChannelsTab(page);

    // Fresh agent: the tab opens on the first-use empty state, offering a
    // chat link and saying what Slack and WhatsApp need here.
    await expect(page.getByText("No channels yet")).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByText("Slack and WhatsApp need Stigmer Cloud."),
    ).toBeVisible();

    const linkSlug = `${testAgent.slug}-link`;
    await createFirstChatLink(page, linkSlug);

    // The list shows the chat link's card with its link (the name stays
    // prefilled from the agent, so the card is addressed by the agent's
    // name). The link names the channel by its id, which no rename or
    // later holder of the organization's slug can move.
    await expect(page.getByText("1 channel")).toBeVisible({ timeout: 10_000 });
    const card = page.getByRole("group", { name: `Chat link: ${testAgent.slug}` });
    const expectedPath = await chatPathOf(stigmerClient, testAgent.id, linkSlug);
    await expect(card.getByText(expectedPath)).toBeVisible({ timeout: 10_000 });
    await expect(card.getByText("Active")).toBeVisible();

    // Copy the link (clipboard-permission-free assertion: the toast
    // confirms; the copied URL additionally carries the link token).
    await card
      .getByRole("button", { name: `Copy link for ${testAgent.slug}` })
      .click();
    await expect(page.getByText("Link copied")).toBeVisible({
      timeout: 5_000,
    });

    // The card's switch pauses the link, keeping its configuration.
    await card
      .getByRole("switch", { name: `Turn ${testAgent.slug} off` })
      .click();
    await expect(page.getByText("Chat link paused")).toBeVisible({
      timeout: 10_000,
    });
    await expect(card.getByText("Paused")).toBeVisible({ timeout: 10_000 });

    await deleteChatLink(page, testAgent.slug);
  });

  test("a Slack channel applied through the SDK shows in the same list, and Add channel offers a chat link beside it", async ({
    page,
    testAgent,
    stigmerClient,
  }) => {
    const slackSlug = `${testAgent.slug}-slack`;
    const slack = await stigmerClient.channel.create({
      org: testAgent.org,
      slug: slackSlug,
      name: slackSlug,
      agentRef: { org: testAgent.org, slug: testAgent.slug },
      enabled: true,
      slack: {},
    });

    try {
      await openAgentDetail(page, testAgent.org, testAgent.slug);
      await openChannelsTab(page);

      // The Slack channel is listed, pending its install, and the notice
      // explains why it cannot be connected on this edition.
      await expect(page.getByText("1 channel")).toBeVisible({
        timeout: 10_000,
      });
      const slackCard = page.getByRole("group", { name: `Slack: ${slackSlug}` });
      await expect(slackCard.getByText("Pending install")).toBeVisible();
      await expect(
        page.getByText(/Channel installs require Stigmer Cloud/),
      ).toBeVisible();

      // One Add menu for every type: a chat link here, the vendors
      // disabled with their reason.
      await page.getByRole("button", { name: "Add channel" }).click();
      await expect(
        page.getByRole("menuitem", { name: /Slack.*Needs Stigmer Cloud/ }),
      ).toBeDisabled();
      await page.getByRole("menuitem", { name: /^Chat link/ }).click();
      await fillChatLinkDialog(page, `${testAgent.slug}-link`);

      await expect(page.getByText("2 channels")).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        page.getByRole("group", { name: `Chat link: ${testAgent.slug}` }),
      ).toBeVisible();
      await deleteChatLinkKeepingOthers(page, testAgent.slug);
    } finally {
      await stigmerClient.channel.delete(slack.metadata!.id);
    }
  });

  test("a created chat link persists across a page reload", async ({
    page,
    testAgent,
    stigmerClient,
  }) => {
    await openAgentDetail(page, testAgent.org, testAgent.slug);
    await openChannelsTab(page);
    await expect(page.getByText("No channels yet")).toBeVisible({
      timeout: 10_000,
    });

    const linkSlug = `${testAgent.slug}-link`;
    await createFirstChatLink(page, linkSlug);

    // Reload and come back through the same entry path — the link is a
    // server-side resource, so it must survive the full remount.
    await openAgentDetail(page, testAgent.org, testAgent.slug);
    await openChannelsTab(page);
    await expect(
      page.getByText(await chatPathOf(stigmerClient, testAgent.id, linkSlug)),
    ).toBeVisible({ timeout: 10_000 });

    await deleteChatLink(page, testAgent.slug);
  });

  test("rename the agent from its detail view: the old library URL moves to the new one, and the chat link still answers", async ({
    page,
    testAgent,
    stigmerClient,
  }) => {
    await openAgentDetail(page, testAgent.org, testAgent.slug);
    await openChannelsTab(page);
    await expect(page.getByText("No channels yet")).toBeVisible({
      timeout: 10_000,
    });
    const linkSlug = `${testAgent.slug}-link`;
    await createFirstChatLink(page, linkSlug);
    const chatPath = await chatPathOf(stigmerClient, testAgent.id, linkSlug);

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

    // The chat link names the channel by its id, so it still answers: the
    // server resolves it to the renamed agent, and the page boots (on the
    // open-source stack its guest sign-in is unimplemented, so it shows
    // its error state rather than the agent; the embed spec's posture).
    // The console's chat link is for the organization's members, so the
    // member lane reads it (the anonymous lane answers only a public one).
    const channelId = chatPath.replace("/chat/", "");
    const profile = await stigmerClient.channel.getAgentProfileForMember(channelId);
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
    await openChannelsTab(page);
    await deleteChatLink(page, testAgent.slug);
  });
});

// Deletes the chat link through its card's menu while other channels stay
// listed, so the tab does not return to its empty state.
async function deleteChatLinkKeepingOthers(page: Page, linkName: string) {
  await page
    .getByRole("button", { name: `Actions for ${linkName}`, exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  const confirmDialog = page.getByRole("dialog", { name: "Delete chat link?" });
  await confirmDialog.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByText("Chat link deleted")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText("1 channel")).toBeVisible({ timeout: 10_000 });
}
