import { describe, it, expect } from "vitest";
import { executeDoTasks } from "../do-executor.js";
import { createState } from "../state.js";
import { evaluateExpressionBatch } from "../expression.js";
import type { TaskList, WorkflowModel, ForTaskDef, TaskEntry } from "../types.js";

const doc: WorkflowModel = {
  document: { dsl: "1.0.0", name: "for-test-workflow" },
  do: [],
};

function forTask(
  name: string,
  taskDef: Omit<ForTaskDef, "kind">,
): TaskEntry {
  return { key: name, task: { kind: "for", ...taskDef } as ForTaskDef };
}

describe("for task execution", () => {
  describe("basic array iteration", () => {
    it("iterates over a literal array with default item/index binding", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { items: ["a", "b", "c"] } } },
        forTask("loop", {
          for: { in: "${ $data.items }" },
          do: [
            { key: "capture", task: { kind: "set", set: { captured: "${ $data.item }" } } },
          ],
        }),
      ];

      const state = createState();
      const result = await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.output).toEqual([
        { captured: "a" },
        { captured: "b" },
        { captured: "c" },
      ]);
    });

    it("binds $data.index for each iteration", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { items: ["x", "y"] } } },
        forTask("loop", {
          for: { in: "${ $data.items }" },
          do: [
            { key: "capture", task: { kind: "set", set: { idx: "${ $data.index }", val: "${ $data.item }" } } },
          ],
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.output).toEqual([
        { idx: 0, val: "x" },
        { idx: 1, val: "y" },
      ]);
    });

    it("returns empty array for empty collection", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { items: [] } } },
        forTask("loop", {
          for: { in: "${ $data.items }" },
          do: [
            { key: "never", task: { kind: "set", set: { ran: true } } },
          ],
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.output).toEqual([]);
    });
  });

  describe("custom variable names", () => {
    it("uses custom for.each variable name", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { pets: ["dog", "cat"] } } },
        forTask("loop", {
          for: { each: "pet", in: "${ $data.pets }" },
          do: [
            { key: "capture", task: { kind: "set", set: { animal: "${ $data.pet }" } } },
          ],
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.output).toEqual([
        { animal: "dog" },
        { animal: "cat" },
      ]);
    });

    it("uses custom for.at variable name", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { items: [10, 20] } } },
        forTask("loop", {
          for: { each: "val", at: "pos", in: "${ $data.items }" },
          do: [
            { key: "capture", task: { kind: "set", set: { position: "${ $data.pos }", value: "${ $data.val }" } } },
          ],
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.output).toEqual([
        { position: 0, value: 10 },
        { position: 1, value: 20 },
      ]);
    });
  });

  describe("collection types", () => {
    it("iterates over an object (key/value pairs)", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { config: { host: "localhost", port: 8080 } } } },
        forTask("loop", {
          for: { each: "value", at: "key", in: "${ $data.config }" },
          do: [
            { key: "capture", task: { kind: "set", set: { k: "${ $data.key }", v: "${ $data.value }" } } },
          ],
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      const results = state.output as unknown[];
      expect(results).toHaveLength(2);
      expect(results).toContainEqual({ k: "host", v: "localhost" });
      expect(results).toContainEqual({ k: "port", v: 8080 });
    });

    it("iterates over an integer (count loop)", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { count: 3 } } },
        forTask("loop", {
          for: { in: "${ $data.count }" },
          do: [
            { key: "capture", task: { kind: "set", set: { i: "${ $data.index }" } } },
          ],
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.output).toEqual([
        { i: 0 },
        { i: 1 },
        { i: 2 },
      ]);
    });

    it("throws for non-iterable collection result", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { val: "not-iterable" } } },
        forTask("loop", {
          for: { in: "${ $data.val }" },
          do: [
            { key: "never", task: { kind: "set", set: { ran: true } } },
          ],
        }),
      ];

      const state = createState();
      await expect(
        executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch),
      ).rejects.toThrow("array, object, or non-negative integer");
    });
  });

  describe("state isolation", () => {
    it("each iteration clones from parent — mutations do not propagate", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { items: [1, 2, 3], counter: 0 } } },
        forTask("loop", {
          for: { in: "${ $data.items }" },
          do: [
            {
              key: "capture",
              task: {
                kind: "set",
                set: {
                  seen_counter: "${ $data.counter }",
                  current: "${ $data.item }",
                },
              },
            },
          ],
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      const results = state.output as Record<string, unknown>[];
      // Every iteration sees counter=0 from parent — never a modified value
      expect(results[0]).toEqual({ seen_counter: 0, current: 1 });
      expect(results[1]).toEqual({ seen_counter: 0, current: 2 });
      expect(results[2]).toEqual({ seen_counter: 0, current: 3 });
    });

    it("mutations within one iteration do not leak to the next", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { items: ["a", "b", "c"], marker: "original" } } },
        forTask("loop", {
          for: { in: "${ $data.items }" },
          do: [
            {
              key: "readThenMutate",
              task: {
                kind: "set",
                set: { saw_marker: "${ $data.marker }", item: "${ $data.item }", marker: "mutated" },
              },
            },
          ],
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      const results = state.output as Record<string, unknown>[];
      // Each iteration sees "original" because it clones from parent, not prior iteration
      expect(results[0]).toMatchObject({ saw_marker: "original" });
      expect(results[1]).toMatchObject({ saw_marker: "original" });
      expect(results[2]).toMatchObject({ saw_marker: "original" });
    });

    it("parent state is not mutated by loop body", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { items: [1], marker: "original" } } },
        forTask("loop", {
          for: { in: "${ $data.items }" },
          do: [
            { key: "mutate", task: { kind: "set", set: { marker: "modified" } } },
          ],
        }),
        { key: "verify", task: { kind: "set", set: { final_marker: "${ $data.marker }" } } },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.data.final_marker).toBe("original");
    });
  });

  describe("while condition", () => {
    it("stops iteration when while condition becomes false", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { items: [1, 2, 3, 4, 5] } } },
        forTask("loop", {
          for: { in: "${ $data.items }" },
          while: "${ $data.index < 3 }",
          do: [
            { key: "capture", task: { kind: "set", set: { val: "${ $data.item }" } } },
          ],
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.output).toEqual([
        { val: 1 },
        { val: 2 },
        { val: 3 },
      ]);
    });

    it("executes zero iterations when while is false from start", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { items: [1, 2, 3] } } },
        forTask("loop", {
          for: { in: "${ $data.items }" },
          while: "${ false }",
          do: [
            { key: "never", task: { kind: "set", set: { ran: true } } },
          ],
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.output).toEqual([]);
    });

    it("treats non-boolean while result as false", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { items: [1, 2] } } },
        forTask("loop", {
          for: { in: "${ $data.items }" },
          while: "${ null }",
          do: [
            { key: "never", task: { kind: "set", set: { ran: true } } },
          ],
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.output).toEqual([]);
    });

    it("while condition can reference iteration variables", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { items: [10, 20, 30, 40] } } },
        forTask("loop", {
          for: { in: "${ $data.items }" },
          while: "${ $data.item < 30 }",
          do: [
            { key: "capture", task: { kind: "set", set: { val: "${ $data.item }" } } },
          ],
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.output).toEqual([
        { val: 10 },
        { val: 20 },
      ]);
    });
  });

  describe("flow directives inside for body", () => {
    it("end inside body stops the inner do — result still collected", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { items: [1, 2] } } },
        forTask("loop", {
          for: { in: "${ $data.items }" },
          do: [
            { key: "capture", task: { kind: "set", set: { val: "${ $data.item }" } } },
            { key: "stop", task: { kind: "set", set: { stopped: true }, then: "end" } },
            { key: "unreachable", task: { kind: "set", set: { nope: true } } },
          ],
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      const results = state.output as Record<string, unknown>[];
      expect(results).toHaveLength(2);
      expect(results[0]).toMatchObject({ stopped: true });
      expect(results[0]).not.toHaveProperty("nope");
    });

    it("switch goto works within for body scope", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { items: [1, 2] } } },
        forTask("loop", {
          for: { in: "${ $data.items }" },
          do: [
            {
              key: "decide",
              task: {
                kind: "switch",
                switch: [{ name: "always", when: "${ 1 == 1 }", then: "target" }],
              },
            },
            { key: "skipped", task: { kind: "set", set: { skipped: true } } },
            { key: "target", task: { kind: "set", set: { jumped: true } } },
          ],
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      const results = state.output as Record<string, unknown>[];
      expect(results).toHaveLength(2);
      for (const r of results) {
        expect(r).toMatchObject({ jumped: true });
        expect(r).not.toHaveProperty("skipped");
      }
    });
  });

  describe("nested for loops", () => {
    it("supports for inside for (double iteration)", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { rows: [[1, 2], [3, 4]] } } },
        forTask("outerLoop", {
          for: { each: "row", in: "${ $data.rows }" },
          do: [
            forTask("innerLoop", {
              for: { each: "cell", in: "${ $data.row }" },
              do: [
                { key: "capture", task: { kind: "set", set: { value: "${ $data.cell }" } } },
              ],
            }),
          ],
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.output).toEqual([
        [{ value: 1 }, { value: 2 }],
        [{ value: 3 }, { value: 4 }],
      ]);
    });
  });

  describe("if guard on for task", () => {
    it("skips entire for loop when if condition is false", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { items: [1, 2, 3], skip: true } } },
        {
          key: "loop",
          task: {
            kind: "for",
            if: "${ $data.skip == false }",
            for: { in: "${ $data.items }" },
            do: [
              { key: "capture", task: { kind: "set", set: { ran: true } } },
            ],
          } as ForTaskDef,
        },
        { key: "after", task: { kind: "set", set: { completed: true } } },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.data.completed).toBe(true);
      expect(state.output).toEqual({ completed: true });
    });
  });

  describe("output and export on for task", () => {
    it("output.as transforms the for task result", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { items: [1, 2, 3] } } },
        {
          key: "loop",
          task: {
            kind: "for",
            for: { in: "${ $data.items }" },
            do: [
              { key: "double", task: { kind: "set", set: { val: "${ $data.item * 2 }" } } },
            ],
            output: { as: "${ . | length }" },
          } as ForTaskDef,
        },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.output).toBe(3);
    });

    it("export.as stores for task result in context", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { items: [10, 20] } } },
        {
          key: "loop",
          task: {
            kind: "for",
            for: { in: "${ $data.items }" },
            do: [
              { key: "capture", task: { kind: "set", set: { val: "${ $data.item }" } } },
            ],
            export: { as: "${ . }" },
          } as ForTaskDef,
        },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.context).toEqual({
        loop: [{ val: 10 }, { val: 20 }],
      });
    });
  });

  describe("context access inside loop body", () => {
    it("loop body can read $context from prior export", async () => {
      const tasks: TaskList = [
        {
          key: "init",
          task: {
            kind: "set",
            set: { items: [1, 2, 3], prefix: "run" },
            export: { as: "${ . }" },
          },
        },
        forTask("loop", {
          for: { in: "${ $context.init.items }" },
          do: [
            {
              key: "capture",
              task: {
                kind: "set",
                set: { label: "${ $context.init.prefix }", val: "${ $data.item }" },
              },
            },
          ],
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      const results = state.output as Record<string, unknown>[];
      expect(results).toHaveLength(3);
      for (const r of results) {
        expect(r).toHaveProperty("label", "run");
      }
    });
  });

  describe("for task after setup and switch (golden 09 pattern)", () => {
    it("for loop reads collection from context set by prior tasks", async () => {
      const tasks: TaskList = [
        {
          key: "initialize",
          task: {
            kind: "set",
            set: { items: [1, 2, 3], shouldProceed: "TRUE" },
            export: { as: "${ . }" },
          },
        },
        {
          key: "checkResult",
          task: {
            kind: "switch",
            switch: [
              { name: "successCase", when: "${ 1 == 1 }", then: "processLoop" },
            ],
          },
        },
        forTask("processLoop", {
          for: { each: "item", in: "${ $context.initialize.items }" },
          do: [
            {
              key: "processItem",
              task: {
                kind: "set",
                set: { processed: "${ $data.item }" },
              },
            },
          ],
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.output).toEqual([
        { processed: 1 },
        { processed: 2 },
        { processed: 3 },
      ]);
    });
  });
});
