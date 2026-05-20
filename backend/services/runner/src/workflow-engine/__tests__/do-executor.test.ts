import { describe, it, expect } from "vitest";
import { executeDoTasks } from "../do-executor.js";
import { createState } from "../state.js";
import { evaluateExpressionBatch } from "../expression.js";
import type { TaskList, WorkflowModel } from "../types.js";

const doc: WorkflowModel = {
  document: { dsl: "1.0.0", name: "test-workflow" },
  do: [],
};

describe("executeDoTasks", () => {
  describe("sequential set task execution", () => {
    it("executes three set tasks in sequence — golden YAML 01", async () => {
      const tasks: TaskList = [
        { key: "initialize", task: { kind: "set", set: { workflow_started: true } } },
        { key: "hello", task: { kind: "set", set: { message: "Hello, Zigflow!", status: "success", executed: true } } },
        { key: "finalize", task: { kind: "set", set: { workflow_completed: true } } },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.data.workflow_started).toBe(true);
      expect(state.data.message).toBe("Hello, Zigflow!");
      expect(state.data.status).toBe("success");
      expect(state.data.executed).toBe(true);
      expect(state.data.workflow_completed).toBe(true);
    });

    it("returns the last task output as the workflow output", async () => {
      const tasks: TaskList = [
        { key: "step1", task: { kind: "set", set: { a: 1 } } },
        { key: "step2", task: { kind: "set", set: { b: 2 } } },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.output).toEqual({ b: 2 });
    });
  });

  describe("switch flow directives", () => {
    it("jumps to named task via switch then directive", async () => {
      const tasks: TaskList = [
        {
          key: "decide",
          task: {
            kind: "switch",
            switch: [
              { name: "always", when: "${ 1 == 1 }", then: "target" },
            ],
          },
        },
        { key: "skipped", task: { kind: "set", set: { should_not_run: true } } },
        { key: "target", task: { kind: "set", set: { reached: true } } },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.data.should_not_run).toBeUndefined();
      expect(state.data.reached).toBe(true);
    });

    it("terminates workflow on switch then: end", async () => {
      const tasks: TaskList = [
        { key: "step1", task: { kind: "set", set: { ran: true } } },
        {
          key: "decide",
          task: {
            kind: "switch",
            switch: [
              { name: "always", when: "${ 1 == 1 }", then: "end" },
            ],
          },
        },
        { key: "unreachable", task: { kind: "set", set: { should_not_run: true } } },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.data.ran).toBe(true);
      expect(state.data.should_not_run).toBeUndefined();
    });

    it("evaluates switch with $context variable", async () => {
      const tasks: TaskList = [
        {
          key: "classify",
          task: {
            kind: "switch",
            switch: [
              { name: "high", when: "${ $context.userId > 5 }", then: "highPath" },
              { name: "low", when: "${ $context.userId <= 5 }", then: "lowPath" },
            ],
          },
        },
        { key: "lowPath", task: { kind: "set", set: { tier: "low" } } },
        { key: "highPath", task: { kind: "set", set: { tier: "high" } } },
      ];

      const state = createState();
      state.context = { userId: 10 };
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.data.tier).toBe("high");
    });
  });

  describe("static then flow directives", () => {
    it("terminates on then: end", async () => {
      const tasks: TaskList = [
        { key: "step1", task: { kind: "set", set: { a: 1 }, then: "end" } },
        { key: "step2", task: { kind: "set", set: { b: 2 } } },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.data.a).toBe(1);
      expect(state.data.b).toBeUndefined();
    });

    it("jumps to named task via then directive", async () => {
      const tasks: TaskList = [
        { key: "step1", task: { kind: "set", set: { a: 1 }, then: "step3" } },
        { key: "step2", task: { kind: "set", set: { skipped: true } } },
        { key: "step3", task: { kind: "set", set: { reached: true } } },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.data.a).toBe(1);
      expect(state.data.skipped).toBeUndefined();
      expect(state.data.reached).toBe(true);
    });

    it("throws on invalid then target", async () => {
      const tasks: TaskList = [
        { key: "step1", task: { kind: "set", set: { a: 1 }, then: "nonexistent" } },
      ];

      const state = createState();
      await expect(
        executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch),
      ).rejects.toThrow("not found in task list");
    });
  });

  describe("if condition guards", () => {
    it("skips task when if condition is false", async () => {
      const tasks: TaskList = [
        { key: "always", task: { kind: "set", set: { ran: true } } },
        { key: "conditional", task: { kind: "set", set: { should_skip: true }, if: "${ 1 == 0 }" } },
        { key: "after", task: { kind: "set", set: { after: true } } },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.data.ran).toBe(true);
      expect(state.data.should_skip).toBeUndefined();
      expect(state.data.after).toBe(true);
    });

    it("runs task when if condition is true", async () => {
      const tasks: TaskList = [
        { key: "conditional", task: { kind: "set", set: { ran: true }, if: "${ 1 == 1 }" } },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.data.ran).toBe(true);
    });

    it("evaluates if condition with state variables", async () => {
      const tasks: TaskList = [
        { key: "step", task: { kind: "set", set: { ran: true }, if: "${ $data.enabled == true }" } },
      ];

      const state = createState();
      state.addData({ enabled: true });
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.data.ran).toBe(true);
    });
  });

  describe("export processing", () => {
    it("processes export.as identity expression", async () => {
      const tasks: TaskList = [
        {
          key: "fetchPost",
          task: {
            kind: "set",
            set: { userId: 1, id: 7, title: "Test post" },
            export: { as: "${ . }" },
          },
        },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.context).toEqual({
        fetchPost: { userId: 1, id: 7, title: "Test post" },
      });
    });

    it("accumulates exports from multiple tasks", async () => {
      const tasks: TaskList = [
        {
          key: "task1",
          task: { kind: "set", set: { a: 1 }, export: { as: "${ . }" } },
        },
        {
          key: "task2",
          task: { kind: "set", set: { b: 2 }, export: { as: "${ . }" } },
        },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.context).toEqual({
        task1: { a: 1 },
        task2: { b: 2 },
      });
    });
  });

  describe("nested do tasks", () => {
    it("executes a nested do block", async () => {
      const tasks: TaskList = [
        { key: "outer", task: { kind: "set", set: { outer: true } } },
        {
          key: "nested",
          task: {
            kind: "do",
            do: [
              { key: "inner1", task: { kind: "set", set: { inner1: true } } },
              { key: "inner2", task: { kind: "set", set: { inner2: true } } },
            ],
          },
        },
        { key: "after", task: { kind: "set", set: { after: true } } },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.data.outer).toBe(true);
      expect(state.data.inner1).toBe(true);
      expect(state.data.inner2).toBe(true);
      expect(state.data.after).toBe(true);
    });
  });

  describe("unsupported task types", () => {
    it("throws for unsupported task types", async () => {
      const tasks: TaskList = [
        { key: "http", task: { kind: "call:http", call: "http", with: { method: "GET", endpoint: { uri: "https://example.com" } } } },
      ];

      const state = createState();
      await expect(
        executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch),
      ).rejects.toThrow("Unsupported task type");
    });
  });

  describe("empty task list", () => {
    it("handles empty do list", async () => {
      const state = createState();
      const result = await executeDoTasks([], null, state, doc, evaluateExpressionBatch);
      expect(result).toBeNull();
    });
  });
});
