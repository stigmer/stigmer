import type { Page } from "@playwright/test";
import type { Stigmer } from "@stigmer/client";
import { test, expect } from "../../fixtures";
import { createTestAgent, createTestEnvironment, ensureOrg } from "../../fixtures/seed-helpers";

/** The organization these journeys seed into and point the console at. */
const ENVIRONMENTS_ORG = "e2e-environments";

/**
 * Environment Library journeys against the live OSS stack.
 *
 * The stack starts no sandboxes (no SANDBOX_PROVISIONER_TYPE), so on it no
 * Environment governs a conversation and the server refuses to save limited
 * networking or packages. The console says so before anyone tries: the
 * list and the form carry the not-applying banner, and "Limited" and the
 * package boxes are offered disabled with the server's reason. An
 * unrestricted Environment with no packages is what this server accepts,
 * and every journey below uses one.
 *
 * The load-bearing behaviors:
 * - an Environment created through the form is in the list and opens on
 *   its page, whose description saves by mask and whose slug renames;
 * - the agent's page names it as the agent's default, and deleting it is
 *   then refused with the server's sentence naming the agent;
 * - the organization's Preferences page sets the default Environment.
 *
 * The functional stack runs with sign-in off, where every caller may do
 * everything, so a member's view (no create, no edit) is proven by the SDK's
 * gate tests and the local-cloud walk, not here.
 */

/** Makes the environments organization the console's active one (stored by id) before the first page loads. */
async function pinActiveOrg(page: Page, stigmerClient: Stigmer): Promise<void> {
  const id = await ensureOrg(stigmerClient, ENVIRONMENTS_ORG, "E2E environments");
  await page.addInitScript((org) => {
    localStorage.setItem("stigmer:activeOrg", org);
  }, id);
}

/** A name two parallel workers never share. */
function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

test.describe("Environments list and form on a server that starts no sandboxes", () => {
  test.beforeEach(async ({ page, stigmerClient }) => {
    await pinActiveOrg(page, stigmerClient);
  });

  test("says Environments don't apply here, offers Limited and packages disabled with the reason, and creates an unrestricted one", async ({
    page,
    stigmerClient,
  }) => {
    const name = uniqueName("e2e-env-form");
    try {
      await page.goto("/library/environments");
      await expect(page.getByRole("heading", { name: "Environments", level: 1 })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/Environments don't apply on this server/)).toBeVisible();

      await page.getByRole("link", { name: "New environment" }).first().click();
      await expect(page.getByRole("heading", { name: "New environment" })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/Environments don't apply on this server/)).toBeVisible();

      // What this server's sandboxes cannot do is said before anyone tries.
      await expect(page.getByRole("radio", { name: /Limited to listed websites/ })).toBeDisabled();
      await expect(page.getByText("This server's sandboxes can't limit networking to listed websites.")).toBeVisible();
      await expect(page.getByRole("radio", { name: /Unrestricted/ })).toBeChecked();
      await expect(page.getByText("This server's sandboxes can't install packages.")).toBeVisible();
      await expect(page.getByLabel("pip (Python packages)")).toBeDisabled();

      await page.getByLabel("Name").fill(name);
      await page.getByLabel(/Description/).fill("Tools for the data team");
      await page.getByRole("button", { name: "Create environment" }).click();

      await expect(page).toHaveURL(new RegExp(`/library/environments/[^/]+/${name}$`), { timeout: 15_000 });
      await expect(page.getByText("Tools for the data team")).toBeVisible();

      await page.goto("/library/environments");
      await expect(page.getByRole("button", { name: new RegExp(name) }).or(page.getByText(name)).first()).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      const created = await stigmerClient.environment
        .getByReference({ org: ENVIRONMENTS_ORG, slug: name })
        .catch(() => undefined);
      if (created?.metadata?.id) {
        await stigmerClient.environment.delete(created.metadata.id).catch(() => {});
      }
    }
  });
});

test.describe("An Environment's page", () => {
  test.beforeEach(async ({ page, stigmerClient }) => {
    await pinActiveOrg(page, stigmerClient);
  });

  test("edits its description by mask, and renames it", async ({ page, stigmerClient }) => {
    const seeded = await createTestEnvironment(stigmerClient, {
      org: ENVIRONMENTS_ORG,
      name: uniqueName("e2e-env-page"),
      description: "before",
    });
    const renamed = `${seeded.slug}-renamed`;
    try {
      await page.goto(`/library/environments/${ENVIRONMENTS_ORG}/${seeded.slug}`);
      await expect(page.getByText("before", { exact: true })).toBeVisible({ timeout: 15_000 });

      await page.getByRole("button", { name: "Edit description" }).click();
      const description = page.locator("textarea");
      await expect(description).toHaveValue("before");
      await description.fill("after");
      await page.getByRole("button", { name: "Save" }).click();
      await expect(description).toBeHidden({ timeout: 15_000 });
      await expect(page.getByText("after", { exact: true })).toBeVisible();

      const saved = await stigmerClient.environment.get(seeded.id);
      expect(saved.spec?.description).toBe("after");

      await page.getByLabel("Slug").fill(renamed);
      await page.getByRole("button", { name: "Rename" }).click();
      await expect(page).toHaveURL(new RegExp(`/library/environments/${ENVIRONMENTS_ORG}/${renamed}$`), {
        timeout: 15_000,
      });
      const byOld = await stigmerClient.environment.getByReference({ org: ENVIRONMENTS_ORG, slug: seeded.slug });
      expect(byOld.metadata?.id).toBe(seeded.id);
      expect(byOld.metadata?.slug).toBe(renamed);
    } finally {
      await seeded.cleanup();
    }
  });

  test("is set as an agent's default on the agent's page, and deleting it is then refused naming the agent", async ({
    page,
    stigmerClient,
  }) => {
    const environment = await createTestEnvironment(stigmerClient, {
      org: ENVIRONMENTS_ORG,
      name: uniqueName("e2e-env-agent"),
    });
    const agent = await createTestAgent(stigmerClient, { org: ENVIRONMENTS_ORG, name: uniqueName("e2e-env-agent-a") });
    try {
      await page.goto(`/library/agents/${ENVIRONMENTS_ORG}/${agent.slug}`);
      await expect(page.getByRole("button", { name: "Edit environment", exact: true })).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: "Edit environment", exact: true }).click();
      await page.getByRole("combobox", { name: "Environment", exact: true }).selectOption(environment.slug);
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.getByRole("combobox", { name: "Environment", exact: true })).toBeHidden({ timeout: 15_000 });

      const saved = await stigmerClient.agent.get(agent.id);
      expect(saved.spec?.environmentRef?.id).toBe(environment.id);

      await page.goto(`/library/environments/${ENVIRONMENTS_ORG}/${environment.slug}`);
      await expect(page.getByRole("heading", { level: 2, name: environment.slug })).toBeVisible({ timeout: 15_000 });
      await page.getByRole("button", { name: /More actions|Actions/ }).click();
      await page.getByRole("menuitem", { name: "Delete" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();

      // The server's guard sentence, naming the agent, reaches the person.
      await expect(page.getByText(new RegExp(`agent '${agent.slug}'`))).toBeVisible({ timeout: 15_000 });
      const still = await stigmerClient.environment.get(environment.id);
      expect(still.metadata?.id).toBe(environment.id);
    } finally {
      await agent.cleanup();
      await environment.cleanup();
    }
  });
});

test.describe("The organization's default Environment", () => {
  test.beforeEach(async ({ page, stigmerClient }) => {
    await pinActiveOrg(page, stigmerClient);
  });

  // Clearing the default after setting it can still read the old id 15 s on,
  // on the plain stack's shard; it has failed on three pull requests that touch
  // neither the console nor the organization API.
  // quarantined: stigmer/stigmer#2482
  test.skip("is set on the Preferences page and saved by id", async ({ page, stigmerClient }) => {
    const environment = await createTestEnvironment(stigmerClient, {
      org: ENVIRONMENTS_ORG,
      name: uniqueName("e2e-env-default"),
    });
    const orgId = await ensureOrg(stigmerClient, ENVIRONMENTS_ORG, "E2E environments");
    try {
      await page.goto("/settings/org-preferences");
      const picker = page.getByRole("combobox", { name: "Default environment" });
      await expect(picker).toBeVisible({ timeout: 15_000 });
      // On a server that starts no sandboxes the row says the default does not apply here.
      await expect(page.getByText(/conversations on this server don't run in sandboxes it starts/)).toBeVisible();
      await expect(picker.locator("option", { hasText: environment.slug })).toHaveCount(1, { timeout: 15_000 });
      await picker.selectOption(environment.slug);

      await expect
        .poll(
          async () =>
            (await stigmerClient.organization.get(orgId)).spec?.preferences?.defaultEnvironmentRef?.id ?? "",
          { timeout: 15_000 },
        )
        .toBe(environment.id);

      await picker.selectOption("");
      await expect
        .poll(
          async () =>
            (await stigmerClient.organization.get(orgId)).spec?.preferences?.defaultEnvironmentRef?.id ?? "",
          { timeout: 15_000 },
        )
        .toBe("");
    } finally {
      const organization = await stigmerClient.organization.get(orgId).catch(() => undefined);
      if (organization?.spec?.preferences?.defaultEnvironmentRef) {
        await stigmerClient.organization
          .update(
            {
              metadata: { id: orgId, etag: organization.metadata?.etag ?? "" },
              spec: { preferences: {} },
            },
            ["spec.preferences.default_environment_ref"],
          )
          .catch(() => {});
      }
      await environment.cleanup();
    }
  });
});
