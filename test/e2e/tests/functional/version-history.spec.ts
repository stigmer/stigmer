import { test, expect } from "../../fixtures";
import { createTestSkill } from "../../fixtures/seed-helpers";
import { navigateToWorkflowDetail } from "../../helpers/workflow-detail";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";

/**
 * Version-history UX coverage.
 *
 * Validates the user-visible symptom that motivated the versioning fixes:
 * "I push multiple times but only ever see one version." These tests seed
 * real version history through the SDK and assert the detail-page timeline
 * renders one entry per distinct content hash (and none for idempotent
 * re-applies/re-pushes).
 */
test.describe("Version history timeline", () => {
  test("workflow: a changed apply shows two timeline entries and a diff", async ({
    page,
    stigmerClient,
  }) => {
    const org = "default";
    const name = `e2e-wf-ver-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const baseInput = {
      name,
      org,
      description: "version-history workflow",
      document: { dsl: "1.0.0", namespace: org, name, version: "1.0.0" },
    };

    const v1 = await stigmerClient.workflow.apply({
      ...baseInput,
      tasks: [
        {
          name: "step-one",
          kind: WorkflowTaskKind.set_vars,
          taskConfig: { variables: { greeting: "v1" } },
          export: { as: "${ . }" },
        },
      ],
    });
    const workflowId = v1.metadata!.id;

    try {
      // Apply changed content → a second, distinct version.
      await stigmerClient.workflow.apply({
        ...baseInput,
        tasks: [
          {
            name: "step-one",
            kind: WorkflowTaskKind.set_vars,
            taskConfig: { variables: { greeting: "v2-changed" } },
            export: { as: "${ . }" },
          },
        ],
      });

      await navigateToWorkflowDetail(page, org, name);

      await page.getByRole("tab", { name: /Versions/ }).click();

      const timeline = page.getByRole("list", { name: "Workflow version history" });
      await expect(timeline).toBeVisible({ timeout: 15_000 });

      const entries = timeline.getByRole("listitem");
      await expect(entries).toHaveCount(2);

      // The newest version is flagged current.
      await expect(page.getByLabel("Current version").first()).toBeVisible();

      // Selecting the older entry opens the diff viewer against current.
      await entries.nth(1).getByRole("button").first().click();
      await expect(page.getByText(/Comparing/)).toBeVisible({ timeout: 15_000 });
    } finally {
      await stigmerClient.workflow.delete(workflowId).catch(() => {});
    }
  });

  test("workflow: an identical re-apply does not add a timeline entry", async ({
    page,
    stigmerClient,
  }) => {
    const org = "default";
    const name = `e2e-wf-noop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const input = {
      name,
      org,
      description: "idempotent workflow",
      document: { dsl: "1.0.0", namespace: org, name, version: "1.0.0" },
      tasks: [
        {
          name: "only-step",
          kind: WorkflowTaskKind.set_vars,
          taskConfig: { variables: { value: "constant" } },
          export: { as: "${ . }" },
        },
      ],
    };

    const created = await stigmerClient.workflow.apply(input);
    const workflowId = created.metadata!.id;

    try {
      // Re-apply byte-identical content — must not create a new version.
      await stigmerClient.workflow.apply(input);

      await navigateToWorkflowDetail(page, org, name);
      await page.getByRole("tab", { name: /Versions/ }).click();

      const timeline = page.getByRole("list", { name: "Workflow version history" });
      await expect(timeline).toBeVisible({ timeout: 15_000 });
      await expect(timeline.getByRole("listitem")).toHaveCount(1);
    } finally {
      await stigmerClient.workflow.delete(workflowId).catch(() => {});
    }
  });

  test("skill: a changed push shows two entries and opens the diff dialog", async ({
    page,
    stigmerClient,
  }) => {
    const skill = await createTestSkill(stigmerClient, {
      body: "Initial version body.",
    });

    try {
      // Push changed content → a second, distinct version.
      await skill.pushUpdate("Updated version body with different content.");

      await page.goto(`/library/skills/${skill.org}/${skill.slug}`);
      await page.waitForLoadState("networkidle");

      await page.getByRole("tab", { name: /Versions/ }).click();

      const timeline = page.getByRole("list", { name: "Version history" });
      await expect(timeline).toBeVisible({ timeout: 15_000 });

      const entries = timeline.getByRole("listitem");
      await expect(entries).toHaveCount(2);

      // Skill timeline uses compare mode: selecting two entries opens the diff.
      await entries.nth(0).getByRole("button").first().click();
      await entries.nth(1).getByRole("button").first().click();
      await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 });
    } finally {
      await skill.cleanup();
    }
  });
});
