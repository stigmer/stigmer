import { test, expect } from "../../fixtures";
import { navigateToWorkflowDetail } from "../../helpers/workflow-detail";

/**
 * The workflow detail page of a seeded workflow (`testWorkflow`: two
 * `set_vars` tasks, a known description): its heading and tabs, the
 * overview's description, switching tabs, the kebab's actions and the Run
 * action. Every case opens the workflow it seeded.
 */
test.describe("Workflow detail page", () => {
  test("renders the workflow's heading and the four detail tabs, Overview selected", async ({
    page,
    testWorkflow,
  }) => {
    await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);

    await expect(page.getByRole("heading", { name: testWorkflow.slug })).toBeVisible();
    const tabs = page.getByRole("tablist", { name: "Workflow detail tabs" });
    for (const name of ["Overview", "Instances", "Executions", "Editor"]) {
      await expect(tabs.getByRole("tab", { name })).toBeVisible();
    }
    await expect(tabs.getByRole("tab", { name: "Overview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("the overview shows the workflow's description", async ({ page, testWorkflow }) => {
    await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);

    await expect(
      page.getByText("E2E test workflow with deterministic set_vars tasks").first(),
    ).toBeVisible();
  });

  test("selecting a tab selects it", async ({ page, testWorkflow }) => {
    await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);
    const tabs = page.getByRole("tablist", { name: "Workflow detail tabs" });

    for (const name of ["Instances", "Executions"]) {
      const tab = tabs.getByRole("tab", { name });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
    }
  });

  test("the kebab offers the workflow's copy, export, access and delete actions", async ({
    page,
    testWorkflow,
  }) => {
    await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);

    await page.getByRole("button", { name: "More actions" }).first().click();
    const menu = page.getByRole("menu");
    for (const name of ["Copy ID", "Copy slug", "Export YAML", "Manage access", "Delete"]) {
      await expect(menu.getByRole("menuitem", { name })).toBeVisible();
    }
  });

  test("offers Run", async ({ page, testWorkflow }) => {
    await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);

    await expect(page.getByRole("button", { name: "Run", exact: true })).toBeEnabled();
  });
});
