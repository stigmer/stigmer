import type { Locator, Page } from "@playwright/test";
import { WorkflowRunVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { test, expect } from "../../fixtures";
import { openManageAccessFromKebab } from "../../helpers/access";
import { assertNoErrorBoundary } from "../../helpers/navigation";
import {
  navigateToWorkflowDetail,
  openRunDialog,
  submitRunAndWaitForRunPage,
} from "../../helpers/workflow-detail";
import { waitForPhaseBadge } from "../../helpers/workflow-run";

/**
 * Running a workflow, and who sees its runs, from the workflow's own page.
 *
 * A run names its workflow and nothing else: the Run dialog offers no copy
 * of the workflow to pick, and the run it starts belongs to the workflow.
 * Who sees the workflow's runs is a setting of the workflow, under "Run
 * visibility" in its Manage access dialog, offered to its owner: only the
 * person who starts a run (the level a workflow starts at), or everyone in
 * its organization, past runs included. While the runs are the
 * organization's, the Run dialog says so before a run starts, because the
 * run's input and output will be visible too.
 *
 * The journey runs on the local stack, where the console signs in as its
 * one person. That a teammate then reads the run, and loses it when the
 * setting goes back, needs a second person and is pinned on the enforcing
 * lane by the conformance suite
 * (test/conformance/src/suites-execution/workflowrun-run-visibility.conformance.test.ts).
 */

const ORG_RUNS_NOTE = "Every run of this workflow is visible to everyone in its organization.";

function runVisibility(dialog: Locator): Locator {
  return dialog.getByRole("radiogroup", { name: "Run visibility" });
}

/** Chooses a run-visibility option in Manage access and waits for it to be the selected one. */
async function chooseRunVisibility(page: Page, option: string): Promise<void> {
  const dialog = await openManageAccessFromKebab(page);
  const choice = runVisibility(dialog).getByRole("radio", { name: new RegExp(`^${option}`) });
  await choice.click();
  await expect(choice).toHaveAttribute("aria-checked", "true", { timeout: 15_000 });
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).not.toBeVisible();
}

test.describe("Workflow run visibility", () => {
  test("runs the workflow with no copy to pick, then opens its runs to the organization and closes them again", async ({
    page,
    testWorkflow,
    stigmerClient,
  }) => {
    await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);
    await assertNoErrorBoundary(page);

    // The Run dialog starts a run of the workflow itself, and while the
    // runs are private it says nothing about who sees them.
    await openRunDialog(page);
    const runDialog = page.getByRole("dialog");
    await expect(runDialog.getByText(ORG_RUNS_NOTE)).toHaveCount(0);
    await submitRunAndWaitForRunPage(page);
    await waitForPhaseBadge(page, "Completed", { timeout: 30_000 });

    const runId = /\/runs\/(wex_[0-9a-z]+)/.exec(page.url())?.[1];
    expect(runId, `the execution page URL names the run: ${page.url()}`).toBeDefined();
    const run = await stigmerClient.workflowRun.get(runId!);
    expect(run.spec?.workflowId, "the run names its workflow").toBe(testWorkflow.id);
    const pinned = (await stigmerClient.workflow.get(testWorkflow.id)).status?.versionHash;
    expect(pinned, "the workflow has a version").toMatch(/^[0-9a-f]{64}$/);
    expect(run.status?.workflowVersionHash, "the run pinned the workflow's version").toBe(pinned);

    // The owner opens the runs to the organization on the workflow page.
    await navigateToWorkflowDetail(page, testWorkflow.org, testWorkflow.slug);
    const accessDialog = await openManageAccessFromKebab(page);
    await expect(
      runVisibility(accessDialog).getByRole("radio", { name: /^Only the person who runs it/ }),
      "a workflow's runs start private",
    ).toHaveAttribute("aria-checked", "true");
    await accessDialog.getByRole("button", { name: "Done" }).click();

    await chooseRunVisibility(page, "All organization members");
    await expect
      .poll(async () => (await stigmerClient.workflow.get(testWorkflow.id)).spec?.runVisibility, {
        timeout: 15_000,
      })
      .toBe(WorkflowRunVisibility.organization);

    // The next run says, before it starts, who will see it.
    await openRunDialog(page);
    await expect(page.getByRole("dialog").getByText(ORG_RUNS_NOTE)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();

    // And back: the runs are their runners' own again.
    await chooseRunVisibility(page, "Only the person who runs it");
    await expect
      .poll(async () => (await stigmerClient.workflow.get(testWorkflow.id)).spec?.runVisibility, {
        timeout: 15_000,
      })
      .toBe(WorkflowRunVisibility.private);
    await openRunDialog(page);
    await expect(page.getByRole("dialog").getByText(ORG_RUNS_NOTE)).toHaveCount(0);
  });
});
