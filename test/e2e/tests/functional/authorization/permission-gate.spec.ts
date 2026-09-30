import { test, expect } from "../../../fixtures";

/**
 * What the owner of a resource is offered on its detail page, on the
 * open-source server: the actions that change or remove the resource and
 * the access controls, on an agent and a workflow the test seeded (so the
 * signed-in operator owns them).
 *
 * Hiding these actions from someone who is not an owner needs a second
 * principal with a narrower role, which only an edition with per-person
 * authorization serves; that journey belongs to the hosted edition's
 * suite, not this open-source lane.
 */
test.describe("Permission-gated actions for the owner", () => {
  test("the owner of an agent can edit, delete, share and manage access, and start a session", async ({
    page,
    testAgent,
  }) => {
    await page.goto(`/library/agents/${testAgent.org}/${testAgent.slug}`);

    await expect(page.getByRole("button", { name: "Start session" })).toBeEnabled({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "More actions" }).first().click();
    const menu = page.getByRole("menu", { name: "More actions" });
    for (const name of ["Edit YAML", "Delete", "Share", "Manage access"]) {
      await expect(menu.getByRole("menuitem", { name })).toBeVisible();
    }
  });

  test("the owner of a workflow can edit, delete and manage access, and run it", async ({
    page,
    testWorkflow,
  }) => {
    await page.goto(`/library/workflows/${testWorkflow.org}/${testWorkflow.slug}`);

    await expect(page.getByRole("button", { name: "Run", exact: true })).toBeEnabled({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "More actions" }).first().click();
    const menu = page.getByRole("menu", { name: "More actions" });
    for (const name of ["Edit YAML", "Delete", "Manage access"]) {
      await expect(menu.getByRole("menuitem", { name })).toBeVisible();
    }
  });
});
