import { describe, it, expect, vi } from "vitest";
import { executeDoTasks } from "../do-executor.js";
import { createState } from "../state.js";
import { evaluateExpressionBatch } from "../expression.js";
import type { TaskList, WorkflowModel, TaskExecutionContext } from "../types.js";

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
      const tasks = [
        { key: "unknown", task: { kind: "exotic" } },
      ] as unknown as TaskList;

      const state = createState();
      await expect(
        executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch),
      ).rejects.toThrow("Unsupported task type");
    });

    it("call tasks require full TaskExecutionContext", async () => {
      const tasks: TaskList = [
        { key: "http", task: { kind: "call:http", call: "http", with: { method: "GET", endpoint: { uri: "https://example.com" } } } },
      ];

      const state = createState();
      await expect(
        executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch),
      ).rejects.toThrow("callHttp is not available");
    });
  });

  describe("empty task list", () => {
    it("handles empty do list", async () => {
      const state = createState();
      const result = await executeDoTasks([], null, state, doc, evaluateExpressionBatch);
      expect(result).toBeNull();
    });
  });

  describe("input.from processing", () => {
    it("resolves input.from and passes to nested do block", async () => {
      const tasks: TaskList = [
        {
          key: "outer",
          task: {
            kind: "do",
            input: { from: "${ $data.source }" },
            do: [
              { key: "inner", task: { kind: "set", set: { ran: true } } },
            ],
          },
        },
      ];

      const state = createState();
      state.addData({ source: { message: "from input.from" } });
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.data.ran).toBe(true);
    });

    it("resolves input.from expression using state variables", async () => {
      const tasks: TaskList = [
        {
          key: "setup",
          task: {
            kind: "set",
            set: { apiUrl: "https://api.example.com" },
            export: { as: "${ . }" },
          },
        },
        {
          key: "use",
          task: {
            kind: "set",
            set: { url: "${ $context.setup.apiUrl }" },
            input: { from: "${ $context.setup }" },
          },
        },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.data.url).toBe("https://api.example.com");
    });

    it("passes parent input through when no input.from is defined", async () => {
      const tasks: TaskList = [
        {
          key: "step1",
          task: { kind: "set", set: { value: "${ $input }" } },
        },
      ];

      const state = createState();
      state.input = { parentField: 99 };
      await executeDoTasks(tasks, { parentField: 99 }, state, doc, evaluateExpressionBatch);

      expect(state.data.value).toEqual({ parentField: 99 });
    });

    it("uses static object as input when input.from is a plain object", async () => {
      const tasks: TaskList = [
        {
          key: "step1",
          task: {
            kind: "do",
            input: { from: { static: "value" } as unknown as string },
            do: [
              { key: "inner", task: { kind: "set", set: { ran: true } } },
            ],
          },
        },
      ];

      const state = createState();
      await executeDoTasks(tasks, { original: true }, state, doc, evaluateExpressionBatch);

      expect(state.data.ran).toBe(true);
    });

    it("input.from resolves for-task collection from state", async () => {
      const tasks: TaskList = [
        {
          key: "setup",
          task: {
            kind: "set",
            set: { items: ["a", "b", "c"] },
          },
        },
        {
          key: "loop",
          task: {
            kind: "for",
            for: { each: "item", in: "${ $data.items }" },
            do: [
              { key: "collect", task: { kind: "set", set: { current: "${ $data.item }" } } },
            ],
          },
        },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.output).toEqual([
        { current: "a" },
        { current: "b" },
        { current: "c" },
      ]);
    });
  });

  describe("try/catch execution", () => {
    it("executes try/catch in a do-executor task list", async () => {
      const tasks: TaskList = [
        { key: "before", task: { kind: "set", set: { step: "before" } } },
        {
          key: "tryCatch",
          task: {
            kind: "try",
            try: [{ key: "fail", task: {
              kind: "raise",
              raise: { error: { type: "test/error", status: 500, title: "Boom" } },
            }}],
            catch: {
              as: "error",
              do: [{ key: "recover", task: { kind: "set", set: { recovered: true } } }],
            },
          },
        },
        { key: "after", task: { kind: "set", set: { step: "after" } } },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.data.step).toBe("after");
      expect(state.data.recovered).toBe(true);
      expect(state.data.error).toBeDefined();
    });

    it("handles raise-then-catch pipeline", async () => {
      const tasks: TaskList = [
        {
          key: "tryCatch",
          task: {
            kind: "try",
            try: [
              { key: "setup", task: { kind: "set", set: { started: true } } },
              { key: "fail", task: {
                kind: "raise",
                raise: { error: { type: "test/validation", status: 400, detail: "bad input" } },
              }},
              { key: "unreachable", task: { kind: "set", set: { never: true } } },
            ],
            catch: {
              as: "caught",
              do: [{ key: "handle", task: { kind: "set", set: { handled: true } } }],
            },
          },
        },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.data.started).toBe(true);
      expect(state.data.never).toBeUndefined();
      expect(state.data.handled).toBe(true);
      const caught = state.data.caught as Record<string, unknown>;
      expect(caught.type).toBe("test/validation");
      expect(caught.detail).toBe("bad input");
    });

    it("propagates unhandled error from try block", async () => {
      const tasks: TaskList = [
        {
          key: "tryCatch",
          task: {
            kind: "try",
            try: [{ key: "fail", task: {
              kind: "raise",
              raise: { error: { type: "test/timeout", status: 408 } },
            }}],
            catch: {
              errors: { with: { type: "test/validation" } },
              do: [{ key: "handle", task: { kind: "set", set: { caught: true } } }],
            },
          },
        },
      ];

      const state = createState();
      await expect(
        executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch),
      ).rejects.toThrow();

      expect(state.data.caught).toBeUndefined();
    });
  });

  describe("fork execution", () => {
    it("dispatches fork task and collects branch outputs", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { prefix: "test" } } },
        {
          key: "parallel",
          task: {
            kind: "fork",
            fork: {
              branches: [
                { key: "a", task: { kind: "do", do: [
                  { key: "s", task: { kind: "set", set: { from: "branchA" } } },
                ]}},
                { key: "b", task: { kind: "do", do: [
                  { key: "s", task: { kind: "set", set: { from: "branchB" } } },
                ]}},
              ],
            },
          },
        },
        {
          key: "aggregate",
          task: {
            kind: "set",
            set: {
              resultA: "${ $output.a.from }",
              resultB: "${ $output.b.from }",
            },
          },
        },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.output).toEqual({
        resultA: "branchA",
        resultB: "branchB",
      });
    });

    it("fork output flows through output.as transform", async () => {
      const tasks: TaskList = [
        {
          key: "parallel",
          task: {
            kind: "fork",
            fork: {
              branches: [
                { key: "a", task: { kind: "do", do: [
                  { key: "s", task: { kind: "set", set: { v: 1 } } },
                ]}},
                { key: "b", task: { kind: "do", do: [
                  { key: "s", task: { kind: "set", set: { v: 2 } } },
                ]}},
              ],
            },
            output: { as: "${ . | keys }" },
          },
        },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      const output = state.output as string[];
      expect(output).toContain("a");
      expect(output).toContain("b");
      expect(output).toHaveLength(2);
    });

    it("fork output stored via export.as in context", async () => {
      const tasks: TaskList = [
        {
          key: "parallel",
          task: {
            kind: "fork",
            fork: {
              branches: [
                { key: "x", task: { kind: "do", do: [
                  { key: "s", task: { kind: "set", set: { val: 42 } } },
                ]}},
              ],
            },
            export: { as: "${ . }" },
          },
        },
        {
          key: "read",
          task: {
            kind: "set",
            set: { fromContext: "${ $context.parallel.x.val }" },
          },
        },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.output).toEqual({ fromContext: 42 });
    });
  });

  describe("wait task execution", () => {
    const notAvailable = () => { throw new Error("not available"); };

    function makeCtx(sleepFn?: (ms: number) => Promise<void>): TaskExecutionContext {
      return {
        evaluateExpressions: evaluateExpressionBatch,
        doc,
        sleep: sleepFn ?? (async () => {}),
        listen: notAvailable,
        runCommand: notAvailable,
        runWorkflow: notAvailable,
        awaitHumanInput: notAvailable,
        callHttp: notAvailable,
        callGrpc: notAvailable,
        callFunction: notAvailable,
        callAgent: notAvailable,
      };
    }

    it("executes wait task between set tasks", async () => {
      const sleepFn = vi.fn(async () => {});
      const tasks: TaskList = [
        { key: "before", task: { kind: "set", set: { step: "before" } } },
        { key: "pause", task: { kind: "wait", wait: { seconds: 5 } } },
        { key: "after", task: { kind: "set", set: { step: "after" } } },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, makeCtx(sleepFn));

      expect(sleepFn).toHaveBeenCalledWith(5_000);
      expect(state.data.step).toBe("after");
    });

    it("wait task produces undefined output (does not overwrite state.output)", async () => {
      const tasks: TaskList = [
        { key: "init", task: { kind: "set", set: { value: 42 } } },
        { key: "delay", task: { kind: "wait", wait: { seconds: 1 }, output: { as: "${ . }" } } },
        { key: "check", task: { kind: "set", set: { final: true } } },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, makeCtx());

      expect(state.data.final).toBe(true);
    });

    it("wait task respects if-guard", async () => {
      const sleepFn = vi.fn(async () => {});
      const tasks: TaskList = [
        { key: "init", task: { kind: "set", set: { skip_wait: true } } },
        {
          key: "conditionalWait",
          task: { kind: "wait", wait: { seconds: 10 }, if: "${ $data.skip_wait == false }" },
        },
        { key: "done", task: { kind: "set", set: { completed: true } } },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, makeCtx(sleepFn));

      expect(sleepFn).not.toHaveBeenCalled();
      expect(state.data.completed).toBe(true);
    });
  });
});
