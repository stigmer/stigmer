import { test, expect } from "../../fixtures";
import {
  navigateToExecution,
  waitForPhaseBadge,
  switchCenterView,
  getExecutionGraph,
} from "../../helpers/workflow-execution";
import { assertNoErrorBoundary } from "../../helpers/navigation";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";

const DEFAULT_ORG = "default";

/**
 * Creates a deterministic workflow with a switch_case that always selects
 * the "yes" branch (set_vars sets `go = "yes"`, switch checks for it).
 * Tasks: init_vars → check_condition (switch) → [yes_path | no_path] → End
 */
async function createSwitchBranchWorkflow(
  client: import("@stigmer/sdk").Stigmer,
) {
  const name = `e2e-switch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const workflow = await client.workflow.apply({
    name,
    org: DEFAULT_ORG,
    description: "E2E: deterministic switch_case branch highlighting",
    document: {
      dsl: "1.0.0",
      namespace: DEFAULT_ORG,
      name,
      version: "1.0.0",
    },
    tasks: [
      {
        name: "init_vars",
        kind: WorkflowTaskKind.set_vars,
        taskConfig: { variables: { go: "yes" } },
        export: { as: "${ . }" },
      },
      {
        name: "check_condition",
        kind: WorkflowTaskKind.switch_case,
        taskConfig: {
          cases: [
            { name: "yes_case", when: "${ $context.init_vars.go == 'yes' }", then: "yes_path" },
            { name: "no_case", then: "no_path" },
          ],
        },
      },
      {
        name: "yes_path",
        kind: WorkflowTaskKind.set_vars,
        taskConfig: { variables: { result: "took_yes" } },
        export: { as: "${ . }" },
        flow: { then: "end" },
      },
      {
        name: "no_path",
        kind: WorkflowTaskKind.set_vars,
        taskConfig: { variables: { result: "took_no" } },
        export: { as: "${ . }" },
      },
    ],
  });

  const id = workflow.metadata!.id;

  return {
    id,
    cleanup: async () => {
      await client.workflow.delete(id).catch(() => {});
    },
  };
}

/**
 * Creates a deterministic fork workflow with two parallel branches,
 * each containing a set_vars task.
 */
async function createForkWorkflow(
  client: import("@stigmer/sdk").Stigmer,
) {
  const name = `e2e-fork-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const workflow = await client.workflow.apply({
    name,
    org: DEFAULT_ORG,
    description: "E2E: fork branch progress highlighting",
    document: {
      dsl: "1.0.0",
      namespace: DEFAULT_ORG,
      name,
      version: "1.0.0",
    },
    tasks: [
      {
        name: "setup",
        kind: WorkflowTaskKind.set_vars,
        taskConfig: { variables: { ready: "true" } },
        export: { as: "${ . }" },
      },
      {
        name: "parallel_work",
        kind: WorkflowTaskKind.fork,
        taskConfig: {
          branches: [
            {
              name: "branch_a",
              do: [
                {
                  name: "task_a",
                  kind: "set_vars",
                  task_config: { variables: { a: "done" } },
                  export: { as: "${ . }" },
                },
              ],
            },
            {
              name: "branch_b",
              do: [
                {
                  name: "task_b",
                  kind: "set_vars",
                  task_config: { variables: { b: "done" } },
                  export: { as: "${ . }" },
                },
              ],
            },
          ],
          compete: false,
        },
        export: { as: "${ . }" },
      },
      {
        name: "finalize",
        kind: WorkflowTaskKind.set_vars,
        taskConfig: { variables: { final: "complete" } },
        export: { as: "${ . }" },
      },
    ],
  });

  const id = workflow.metadata!.id;

  return {
    id,
    cleanup: async () => {
      await client.workflow.delete(id).catch(() => {});
    },
  };
}

test.describe("T06: Branch and parallel execution highlighting", () => {
  test("switch_case: taken branch edge shows taken state, untaken shows not_taken", async ({
    page,
    stigmerClient,
  }) => {
    const workflow = await createSwitchBranchWorkflow(stigmerClient);

    try {
      const execName = `e2e-sw-exec-${Date.now()}`;
      const execution = await stigmerClient.workflowExecution.create({
        name: execName,
        org: DEFAULT_ORG,
        workflowId: workflow.id,
      });
      const execId = execution.metadata!.id;

      try {
        await navigateToExecution(page, execId);
        await assertNoErrorBoundary(page);
        await waitForPhaseBadge(page, "Completed", { timeout: 30_000 });
        // Edge execution states render on the graph, which is CSS-hidden
        // behind the Thread default — switch views first.
        await switchCenterView(page, "graph");

        // The switch selects yes_path. Edge to yes_path should be "taken",
        // edge to no_path should be "not_taken". Presence, not visibility:
        // a straight vertical edge path has a zero-width client rect, which
        // Playwright reports as hidden — the graph container's visibility
        // is already asserted by switchCenterView.
        const graph = getExecutionGraph(page);
        const takenEdges = graph.locator('[data-edge-execution-state="taken"]');
        const notTakenEdges = graph.locator('[data-edge-execution-state="not_taken"]');

        await expect(takenEdges.first()).toBeAttached({ timeout: 10_000 });
        const takenCount = await takenEdges.count();
        expect(takenCount).toBeGreaterThanOrEqual(1);

        await expect(notTakenEdges.first()).toBeAttached({ timeout: 5_000 });
        const notTakenCount = await notTakenEdges.count();
        expect(notTakenCount).toBeGreaterThanOrEqual(1);
      } finally {
        await stigmerClient.workflowExecution.delete(execution.metadata!.id).catch(() => {});
      }
    } finally {
      await workflow.cleanup();
    }
  });

  test("completed execution: all sequential edges show taken state", async ({
    page,
    stigmerClient,
  }) => {
    // Use a simple linear workflow (the default test fixture pattern)
    const name = `e2e-linear-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const workflow = await stigmerClient.workflow.apply({
      name,
      org: DEFAULT_ORG,
      description: "E2E linear workflow for edge highlighting",
      document: { dsl: "1.0.0", namespace: DEFAULT_ORG, name, version: "1.0.0" },
      tasks: [
        { name: "step_a", kind: WorkflowTaskKind.set_vars, taskConfig: { variables: { a: "1" } }, export: { as: "${ . }" } },
        { name: "step_b", kind: WorkflowTaskKind.set_vars, taskConfig: { variables: { b: "2" } }, export: { as: "${ . }" } },
      ],
    });
    const wfId = workflow.metadata!.id;

    try {
      const execution = await stigmerClient.workflowExecution.create({
        name: `e2e-lin-exec-${Date.now()}`,
        org: DEFAULT_ORG,
        workflowId: wfId,
      });
      const execId = execution.metadata!.id;

      try {
        await navigateToExecution(page, execId);
        await assertNoErrorBoundary(page);
        await waitForPhaseBadge(page, "Completed", { timeout: 30_000 });
        await switchCenterView(page, "graph");

        // Presence, not visibility — see the zero-width-path note above.
        const takenEdges = getExecutionGraph(page).locator(
          '[data-edge-execution-state="taken"]',
        );
        await expect(takenEdges.first()).toBeAttached({ timeout: 10_000 });

        const count = await takenEdges.count();
        expect(count).toBeGreaterThanOrEqual(2);
      } finally {
        await stigmerClient.workflowExecution.delete(execution.metadata!.id).catch(() => {});
      }
    } finally {
      await stigmerClient.workflow.delete(wfId).catch(() => {});
    }
  });

  test("fork workflow: completed fork node shows completed badge", async ({
    page,
    stigmerClient,
  }) => {
    const workflow = await createForkWorkflow(stigmerClient);

    try {
      const execution = await stigmerClient.workflowExecution.create({
        name: `e2e-fork-exec-${Date.now()}`,
        org: DEFAULT_ORG,
        workflowId: workflow.id,
      });
      const execId = execution.metadata!.id;

      try {
        await navigateToExecution(page, execId);
        await assertNoErrorBoundary(page);
        await waitForPhaseBadge(page, "Completed", { timeout: 30_000 });
        await switchCenterView(page, "graph");

        // The fork node should have completed status.
        const forkNode = getExecutionGraph(page).locator(
          '[data-task-kind="fork"][data-execution-status="completed"]',
        );
        await expect(forkNode).toBeVisible({ timeout: 10_000 });
      } finally {
        await stigmerClient.workflowExecution.delete(execution.metadata!.id).catch(() => {});
      }
    } finally {
      await workflow.cleanup();
    }
  });
});
