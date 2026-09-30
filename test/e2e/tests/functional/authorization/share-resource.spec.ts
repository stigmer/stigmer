import { create } from "@bufbuild/protobuf";
import { GetAgentInstancesByAgentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/io_pb";
import { test, expect } from "../../../fixtures";
import { openManageAccessFromKebab } from "../../../helpers/access";

/**
 * The unified "Manage access" dialog on a blueprint.
 *
 * Every resource with a detail surface opens one canonical dialog composing
 * both access axes: General access (visibility) over People with access
 * (explicit grants). On a static detail page (agent, skill, MCP server,
 * workflow) it opens from a "Manage access" item in the kebab menu.
 *
 * The open-source server does not grant access on a blueprint to individual
 * people (it grants roles on organizations only), so the People axis says
 * so in one sentence and offers no "Add people" control. Enterprise and
 * Cloud add that axis; their grant flow is proven on their own stacks.
 */
test.describe("Manage access on an agent", () => {
  test("the kebab offers Manage access to the owner", async ({ page, testAgent }) => {
    await page.goto(`/library/agents/${testAgent.org}/${testAgent.slug}`);
    await page.getByRole("button", { name: "More actions" }).click();

    await expect(page.getByRole("menuitem", { name: "Manage access" })).toBeEnabled();
  });

  test("the dialog names the resource and shows both axes", async ({ page, testAgent }) => {
    await page.goto(`/library/agents/${testAgent.org}/${testAgent.slug}`);
    const dialog = await openManageAccessFromKebab(page);

    await expect(dialog.getByText(testAgent.slug)).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "General access" })).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "People with access" })).toBeVisible();
  });

  test("on the open-source server, the People axis says there is no per-person sharing and offers no grant", async ({
    page,
    testAgent,
  }) => {
    test.skip(
      !!process.env.STIGMER_E2E_CLOUD,
      "per-person sharing is the Enterprise and Cloud editions' axis; this pins the open-source posture",
    );
    await page.goto(`/library/agents/${testAgent.org}/${testAgent.slug}`);
    const dialog = await openManageAccessFromKebab(page);

    await expect(
      dialog.getByText(
        "This edition does not share agents with individual people. Sharing with specific people is available in Stigmer Enterprise and Cloud.",
      ),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: /Add people/ })).toHaveCount(0);
  });

  test("Done and Close each dismiss the dialog", async ({ page, testAgent }) => {
    await page.goto(`/library/agents/${testAgent.org}/${testAgent.slug}`);

    let dialog = await openManageAccessFromKebab(page);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toBeHidden();

    dialog = await openManageAccessFromKebab(page);
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
  });
});

test.describe("Manage access on a session", () => {
  test("on the open-source server, a session page offers no Manage access button", async ({
    page,
    testAgent,
    stigmerClient,
  }) => {
    test.skip(
      !!process.env.STIGMER_E2E_CLOUD,
      "a session's People axis is the Enterprise and Cloud editions'; this pins the open-source posture",
    );
    const instances = await stigmerClient.agentInstance.getByAgent(
      create(GetAgentInstancesByAgentRequestSchema, { agentId: testAgent.id }),
    );
    const instanceId = instances.items[0]?.metadata?.id;
    expect(instanceId, "every agent gets a default instance").toBeTruthy();
    const session = await stigmerClient.session.create({
      name: `e2e-session-${Date.now()}`,
      org: testAgent.org,
      agentInstanceId: instanceId,
      subject: "manage access posture",
    });
    try {
      await page.goto(`/sessions/${session.metadata!.id}`);

      // The session page itself is up, so the absence below is a posture,
      // not a page that never rendered.
      await expect(page.getByRole("form", { name: "Send message" })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByRole("button", { name: /Manage access/i })).toHaveCount(0);
    } finally {
      await stigmerClient.session.delete(session.metadata!.id).catch(() => {});
    }
  });
});
