import { describe, it, expect } from "vitest";
import { workflowUsesTriggerInput } from "../workflow-uses-trigger-input";

function makeWorkflow(tasks: Array<{ name: string; taskConfig: unknown }>) {
  return {
    spec: {
      tasks: tasks.map((t) => ({
        name: t.name,
        kind: 1,
        taskConfig: t.taskConfig,
      })),
    },
  } as any;
}

describe("workflowUsesTriggerInput", () => {
  it("returns false when workflow has no tasks", () => {
    const workflow = { spec: { tasks: [] } } as any;
    expect(workflowUsesTriggerInput(workflow)).toBe(false);
  });

  it("returns false when workflow spec is undefined", () => {
    const workflow = {} as any;
    expect(workflowUsesTriggerInput(workflow)).toBe(false);
  });

  it("returns false when no task references $input", () => {
    const workflow = makeWorkflow([
      {
        name: "run_analyst",
        taskConfig: {
          agent: "notification-analyst",
          message: "Analyze cohorts. Date: ${ $env.NOTIFICATION_DATE }",
        },
      },
      {
        name: "validate",
        taskConfig: {
          model: "claude-haiku-4.5",
          prompt: "Check: ${ $context.run_analyst.cohorts }",
        },
      },
    ]);

    expect(workflowUsesTriggerInput(workflow)).toBe(false);
  });

  it("returns true when a task references $input directly", () => {
    const workflow = makeWorkflow([
      {
        name: "capture",
        taskConfig: {
          set: { received: "${ $input }" },
        },
      },
    ]);

    expect(workflowUsesTriggerInput(workflow)).toBe(true);
  });

  it("returns true when a task references $input with field access", () => {
    const workflow = makeWorkflow([
      {
        name: "setup",
        taskConfig: {
          set: { pr_number: "${ $input.pr_number }" },
        },
      },
    ]);

    expect(workflowUsesTriggerInput(workflow)).toBe(true);
  });

  it("returns true when a task references workflow.input.trigger_message", () => {
    const workflow = makeWorkflow([
      {
        name: "call_agent",
        taskConfig: {
          agent: "my-agent",
          message: "Handle: {{workflow.input.trigger_message}}",
        },
      },
    ]);

    expect(workflowUsesTriggerInput(workflow)).toBe(true);
  });

  it("detects $input in deeply nested task config", () => {
    const workflow = makeWorkflow([
      {
        name: "deep_task",
        taskConfig: {
          cases: [
            {
              name: "high",
              when: "${ $input.score > 80 }",
              then: "success",
            },
          ],
        },
      },
    ]);

    expect(workflowUsesTriggerInput(workflow)).toBe(true);
  });

  it("detects $input in arrays within task config", () => {
    const workflow = makeWorkflow([
      {
        name: "multi",
        taskConfig: {
          steps: ["first", "${ $input.value }", "third"],
        },
      },
    ]);

    expect(workflowUsesTriggerInput(workflow)).toBe(true);
  });

  it("returns true if only one of many tasks references $input", () => {
    const workflow = makeWorkflow([
      {
        name: "no_input",
        taskConfig: { agent: "analyst", message: "plain message" },
      },
      {
        name: "uses_input",
        taskConfig: {
          agent: "router",
          message: "Route based on: ${ $input.intent }",
        },
      },
      {
        name: "also_no_input",
        taskConfig: { model: "gpt-4", prompt: "Summarize ${ $context.data }" },
      },
    ]);

    expect(workflowUsesTriggerInput(workflow)).toBe(true);
  });

  it("does not false-positive on $context.input_data (no $input substring)", () => {
    const workflow = makeWorkflow([
      {
        name: "misleading",
        taskConfig: {
          message: "Not using input: ${ $context.input_data }",
        },
      },
    ]);

    expect(workflowUsesTriggerInput(workflow)).toBe(false);
  });

  it("handles null taskConfig gracefully", () => {
    const workflow = {
      spec: {
        tasks: [{ name: "empty", kind: 1, taskConfig: null }],
      },
    } as any;

    expect(workflowUsesTriggerInput(workflow)).toBe(false);
  });
});
