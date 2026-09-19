// The workflow editor's AI-assisted actions (Refine, Fix with AI, Explain)
// run on the Organization's Workflow Architect agent and render only when
// it exists. The e2e stack boots a raw server that nothing has bootstrapped
// and no fixture installs that agent, so this spec pins the honest state:
// the actions are absent, and the editor stands whole without them. The
// panel's own behaviour is pinned by the SDK's unit suites, which mount it
// against a stubbed client.
import { test, expect } from "../../fixtures";
import { assertNoErrorBoundary } from "../../helpers/navigation";

async function navigateToEditorTab(
  page: import("@playwright/test").Page,
  org: string,
  slug: string,
) {
  await page.goto(`/library/workflows/${org}/${slug}`);
  await page
    .getByRole("tablist", { name: "Workflow detail tabs" })
    .waitFor({ timeout: 15_000 });
  await page.getByRole("tab", { name: "Editor" }).click();
  await page.waitForTimeout(2000);
}

test.describe("Workflow editor without a Workflow Architect", () => {
  test("Editor tab withholds Refine and Explain, and shows no refinement panel", async ({
    page,
    testWorkflow,
  }) => {
    await navigateToEditorTab(page, testWorkflow.org, testWorkflow.slug);
    await assertNoErrorBoundary(page);

    await expect(
      page.getByRole("tablist", { name: "Editor mode" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByRole("button", { name: "Refine with AI" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Explain this workflow" }),
    ).toHaveCount(0);
    await expect(
      page.locator('[aria-label="Workflow refinement panel"]'),
    ).toHaveCount(0);
  });

  test("mode toggle between Code and Visual is accessible", async ({
    page,
    testWorkflow,
  }) => {
    await navigateToEditorTab(page, testWorkflow.org, testWorkflow.slug);

    const modeTablist = page.getByRole("tablist", { name: "Editor mode" });
    await expect(modeTablist).toBeVisible({ timeout: 10_000 });
    await expect(
      modeTablist.getByRole("tab", { name: "Code" }),
    ).toBeVisible();
    await expect(
      modeTablist.getByRole("tab", { name: "Visual" }),
    ).toBeVisible();
  });
});
