import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluateExpressionBatch } from "../../workflow-engine/expression.js";
import type { WorkflowModel } from "../../workflow-engine/types.js";
import type { ExecuteServerlessWorkflowInput } from "../execute-serverless-workflow.js";

const mockEvaluateExpressions = vi.fn();

vi.mock("@temporalio/workflow", () => ({
  proxyLocalActivities: vi.fn(() => ({
    EvaluateExpressions: (
      exprs: Record<string, string>,
      input: unknown,
      stateVars: Record<string, unknown>,
    ) => mockEvaluateExpressions(exprs, input, stateVars),
  })),
  proxyActivities: vi.fn(() => ({
    CallHttp: vi.fn(),
    CallGrpc: vi.fn(),
    CallFunction: vi.fn(),
  })),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("executeServerlessWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEvaluateExpressions.mockImplementation(
      (exprs, input, stateVars) => evaluateExpressionBatch(exprs, input, stateVars),
    );
  });

  async function runWorkflow(input: ExecuteServerlessWorkflowInput) {
    const { executeServerlessWorkflow } = await import("../execute-serverless-workflow.js");
    return executeServerlessWorkflow(input);
  }

  describe("basic workflow execution", () => {
    it("executes a simple set workflow and returns output", async () => {
      const model: WorkflowModel = {
        document: { dsl: "1.0.0", name: "test-simple" },
        do: [
          { key: "greet", task: { kind: "set", set: { message: "Hello, World!" } } },
        ],
      };

      const result = await runWorkflow({
        model,
        workflow_input: null,
        env: {},
      });

      expect(result).toEqual({ message: "Hello, World!" });
    });

    it("executes multiple set tasks in sequence", async () => {
      const model: WorkflowModel = {
        document: { dsl: "1.0.0", name: "test-multi" },
        do: [
          { key: "step1", task: { kind: "set", set: { a: 1 } } },
          { key: "step2", task: { kind: "set", set: { b: 2 } } },
          { key: "step3", task: { kind: "set", set: { c: 3 } } },
        ],
      };

      const result = await runWorkflow({
        model,
        workflow_input: null,
        env: {},
      });

      expect(result).toEqual({ c: 3 });
    });

    it("passes env vars into state", async () => {
      const model: WorkflowModel = {
        document: { dsl: "1.0.0", name: "test-env" },
        do: [
          { key: "read-env", task: { kind: "set", set: { apiKey: "${ $env.API_KEY }" } } },
        ],
      };

      const result = await runWorkflow({
        model,
        workflow_input: null,
        env: { API_KEY: "secret-123" },
      });

      expect(result).toEqual({ apiKey: "secret-123" });
    });
  });

  describe("workflow-level input.from", () => {
    it("transforms workflow input via input.from expression", async () => {
      const model: WorkflowModel = {
        document: { dsl: "1.0.0", name: "test-input-from" },
        input: { from: "${ .nested.data }" },
        do: [
          { key: "capture", task: { kind: "set", set: { received: "${ $input }" } } },
        ],
      };

      const result = await runWorkflow({
        model,
        workflow_input: { nested: { data: { value: 42 } } },
        env: {},
      });

      expect(result).toEqual({ received: { value: 42 } });
    });

    it("passes input through when input.from is not defined", async () => {
      const model: WorkflowModel = {
        document: { dsl: "1.0.0", name: "test-no-input-from" },
        do: [
          { key: "capture", task: { kind: "set", set: { received: "${ $input }" } } },
        ],
      };

      const result = await runWorkflow({
        model,
        workflow_input: { raw: true },
        env: {},
      });

      expect(result).toEqual({ received: { raw: true } });
    });
  });

  describe("workflow-level output.as", () => {
    it("transforms final output via output.as expression", async () => {
      const model: WorkflowModel = {
        document: { dsl: "1.0.0", name: "test-output-as" },
        output: { as: "${ { result: $data.message, status: \"success\" } }" },
        do: [
          { key: "work", task: { kind: "set", set: { message: "done" } } },
        ],
      };

      const result = await runWorkflow({
        model,
        workflow_input: null,
        env: {},
      });

      expect(result).toEqual({ result: "done", status: "success" });
    });

    it("returns raw output when output.as is not an expression", async () => {
      const model: WorkflowModel = {
        document: { dsl: "1.0.0", name: "test-no-output-as" },
        do: [
          { key: "work", task: { kind: "set", set: { value: 42 } } },
        ],
      };

      const result = await runWorkflow({
        model,
        workflow_input: null,
        env: {},
      });

      expect(result).toEqual({ value: 42 });
    });
  });

  describe("expression evaluation via local activity", () => {
    it("delegates all expression evaluation to the local activity proxy", async () => {
      const model: WorkflowModel = {
        document: { dsl: "1.0.0", name: "test-delegation" },
        do: [
          { key: "compute", task: { kind: "set", set: { sum: "${ .a + .b }" } } },
        ],
      };

      await runWorkflow({
        model,
        workflow_input: { a: 10, b: 32 },
        env: {},
      });

      expect(mockEvaluateExpressions).toHaveBeenCalled();
    });

    it("uuid generation produces valid UUID through the activity", async () => {
      const model: WorkflowModel = {
        document: { dsl: "1.0.0", name: "test-uuid" },
        do: [
          { key: "gen", task: { kind: "set", set: { id: "${ uuid }" } } },
        ],
      };

      const result = await runWorkflow({
        model,
        workflow_input: null,
        env: {},
      });

      const output = result as Record<string, unknown>;
      expect(output.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });

  describe("error handling", () => {
    it("propagates expression evaluation errors", async () => {
      mockEvaluateExpressions.mockRejectedValueOnce(
        new Error("jq evaluation error: invalid expression"),
      );

      const model: WorkflowModel = {
        document: { dsl: "1.0.0", name: "test-error" },
        do: [
          { key: "bad", task: { kind: "set", set: { x: "${ .[invalid }" } } },
        ],
      };

      await expect(
        runWorkflow({ model, workflow_input: null, env: {} }),
      ).rejects.toThrow("jq evaluation error");
    });
  });

  describe("switch with flow directives", () => {
    it("handles switch-driven branching through the workflow", async () => {
      const model: WorkflowModel = {
        document: { dsl: "1.0.0", name: "test-switch" },
        do: [
          {
            key: "route",
            task: {
              kind: "switch",
              switch: [
                { name: "high", when: "${ $input.score > 80 }", then: "success" },
                { name: "default", then: "failure" },
              ],
            },
          },
          { key: "failure", task: { kind: "set", set: { result: "failed" }, then: "end" } },
          { key: "success", task: { kind: "set", set: { result: "passed" } } },
        ],
      };

      const result = await runWorkflow({
        model,
        workflow_input: { score: 95 },
        env: {},
      });

      expect(result).toEqual({ result: "passed" });
    });
  });
});
