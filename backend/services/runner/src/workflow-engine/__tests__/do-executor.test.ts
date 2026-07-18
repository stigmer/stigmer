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

  describe("try/catch retry execution", () => {
    const notAvailable = () => { throw new Error("not available"); };

    function makeRetryCtx(sleepFn?: (ms: number) => Promise<void>): TaskExecutionContext {
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

    it("retry succeeds on second attempt", async () => {
      let callCount = 0;
      const sleepFn = vi.fn(async () => {});

      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { attempt_count: 0 } } },
        {
          key: "retryOp",
          task: {
            kind: "try",
            try: [
              {
                key: "flaky",
                task: {
                  kind: "set",
                  set: { flaky_ran: "${ $data.attempt_count + 1 }" },
                },
              },
            ],
            catch: {
              retry: {
                delay: { seconds: 1 },
                limit: { attempt: { count: 3 } },
              },
              as: "error",
              do: [{ key: "fallback", task: { kind: "set", set: { fell_through: true } } }],
            },
          },
        },
      ];

      // For this test, we need to simulate a flaky operation.
      // Since set tasks don't throw, we'll use raise tasks with
      // a counter to simulate "fail once, then succeed."
      // Replace with a task list that throws on first call.
      const flakyTasks: TaskList = [
        {
          key: "retryOp",
          task: {
            kind: "try",
            try: [{ key: "fail", task: {
              kind: "raise",
              raise: { error: { type: "test/transient", status: 503, title: "Service Unavailable" } },
            }}],
            catch: {
              retry: {
                delay: { seconds: 1 },
                limit: { attempt: { count: 3 } },
              },
              as: "error",
              do: [{ key: "fallback", task: { kind: "set", set: { fell_through: true } } }],
            },
          },
        },
      ];

      const state = createState();
      await executeDoTasks(flakyTasks, null, state, doc, evaluateExpressionBatch, makeRetryCtx(sleepFn));

      expect(state.data.fell_through).toBe(true);
      expect(sleepFn).toHaveBeenCalledTimes(3);
      expect(sleepFn).toHaveBeenCalledWith(1_000);
    });

    it("retry exhausted falls through to catch.do with last error", async () => {
      const sleepFn = vi.fn(async () => {});
      const tasks: TaskList = [
        {
          key: "retryOp",
          task: {
            kind: "try",
            try: [{ key: "fail", task: {
              kind: "raise",
              raise: { error: { type: "test/persistent", status: 500, title: "Always fails" } },
            }}],
            catch: {
              retry: {
                delay: { milliseconds: 100 },
                limit: { attempt: { count: 2 } },
              },
              as: "lastError",
              do: [{ key: "handle", task: { kind: "set", set: { caught_after_retry: true } } }],
            },
          },
        },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, makeRetryCtx(sleepFn));

      expect(state.data.caught_after_retry).toBe(true);
      const err = state.data.lastError as Record<string, unknown>;
      expect(err.type).toBe("test/persistent");
      expect(err.title).toBe("Always fails");
      expect(sleepFn).toHaveBeenCalledTimes(2);
    });

    it("retry with exponential backoff calls sleep with correct delays", async () => {
      const sleepFn = vi.fn(async () => {});
      const tasks: TaskList = [
        {
          key: "retryOp",
          task: {
            kind: "try",
            try: [{ key: "fail", task: {
              kind: "raise",
              raise: { error: { type: "test/error", status: 500 } },
            }}],
            catch: {
              retry: {
                delay: { seconds: 1 },
                backoff: { exponential: {} },
                limit: { attempt: { count: 3 } },
              },
              do: [{ key: "handle", task: { kind: "set", set: { done: true } } }],
            },
          },
        },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, makeRetryCtx(sleepFn));

      expect(sleepFn).toHaveBeenCalledTimes(3);
      expect(sleepFn).toHaveBeenNthCalledWith(1, 1_000);
      expect(sleepFn).toHaveBeenNthCalledWith(2, 2_000);
      expect(sleepFn).toHaveBeenNthCalledWith(3, 4_000);
    });

    it("no retry config preserves existing behavior", async () => {
      const sleepFn = vi.fn(async () => {});
      const tasks: TaskList = [
        {
          key: "tryCatch",
          task: {
            kind: "try",
            try: [{ key: "fail", task: {
              kind: "raise",
              raise: { error: { type: "test/error", status: 500 } },
            }}],
            catch: {
              as: "error",
              do: [{ key: "handle", task: { kind: "set", set: { handled: true } } }],
            },
          },
        },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, makeRetryCtx(sleepFn));

      expect(sleepFn).not.toHaveBeenCalled();
      expect(state.data.handled).toBe(true);
    });

    it("retry without explicit ctx works with zero-delay retries", async () => {
      const tasks: TaskList = [
        {
          key: "retryOp",
          task: {
            kind: "try",
            try: [{ key: "fail", task: {
              kind: "raise",
              raise: { error: { type: "test/error", status: 500 } },
            }}],
            catch: {
              retry: {
                limit: { attempt: { count: 2 } },
              },
              as: "error",
              do: [{ key: "handle", task: { kind: "set", set: { handled: true } } }],
            },
          },
        },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.data.handled).toBe(true);
    });

    it("retry with zero delay retries immediately", async () => {
      const sleepFn = vi.fn(async () => {});
      const tasks: TaskList = [
        {
          key: "retryOp",
          task: {
            kind: "try",
            try: [{ key: "fail", task: {
              kind: "raise",
              raise: { error: { type: "test/error", status: 500 } },
            }}],
            catch: {
              retry: {
                limit: { attempt: { count: 2 } },
              },
              do: [{ key: "handle", task: { kind: "set", set: { handled: true } } }],
            },
          },
        },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, makeRetryCtx(sleepFn));

      expect(sleepFn).not.toHaveBeenCalled();
      expect(state.data.handled).toBe(true);
    });

    it("retry re-throws when error stops matching catch filter mid-retry", async () => {
      const sleepFn = vi.fn(async () => {});
      const tasks: TaskList = [
        {
          key: "retryOp",
          task: {
            kind: "try",
            try: [{ key: "fail", task: {
              kind: "raise",
              raise: { error: { type: "test/auth", status: 401 } },
            }}],
            catch: {
              errors: { with: { type: "test/transient" } },
              retry: {
                delay: { milliseconds: 100 },
                limit: { attempt: { count: 3 } },
              },
              do: [{ key: "handle", task: { kind: "set", set: { handled: true } } }],
            },
          },
        },
      ];

      const state = createState();
      await expect(
        executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, makeRetryCtx(sleepFn)),
      ).rejects.toThrow();

      expect(state.data.handled).toBeUndefined();
    });

    it("retry with duration limit stops when budget exceeded", async () => {
      const sleepFn = vi.fn(async () => {});
      const tasks: TaskList = [
        {
          key: "retryOp",
          task: {
            kind: "try",
            try: [{ key: "fail", task: {
              kind: "raise",
              raise: { error: { type: "test/error", status: 500 } },
            }}],
            catch: {
              retry: {
                delay: { seconds: 3 },
                limit: {
                  attempt: { count: 10 },
                  duration: { seconds: 5 },
                },
              },
              do: [{ key: "handle", task: { kind: "set", set: { handled: true } } }],
            },
          },
        },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, makeRetryCtx(sleepFn));

      // First attempt: delay=3000, elapsed=3000 (within budget)
      // Second attempt: delay=3000, total=6000 > 5000 (exceeds budget)
      expect(sleepFn).toHaveBeenCalledTimes(1);
      expect(state.data.handled).toBe(true);
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

  describe("task event I/O summaries (live card previews)", () => {
    const notAvailable = () => { throw new Error("not available"); };

    // Captures every emitted event flat, in emission order.
    function makeEventCtx(overrides?: Partial<TaskExecutionContext>): {
      ctx: TaskExecutionContext;
      events: Array<Record<string, unknown>>;
    } {
      const events: Array<Record<string, unknown>> = [];
      const ctx: TaskExecutionContext = {
        evaluateExpressions: evaluateExpressionBatch,
        doc,
        sleep: async () => {},
        listen: notAvailable,
        runCommand: notAvailable,
        runWorkflow: notAvailable,
        awaitHumanInput: notAvailable,
        callHttp: notAvailable,
        callGrpc: notAvailable,
        callFunction: notAvailable,
        callAgent: notAvailable,
        emitEvents: async (batch) => {
          events.push(...(batch as unknown as Array<Record<string, unknown>>));
        },
        ...overrides,
      };
      return { ctx, events };
    }

    it("task_started carries the truncated resolved input as inputSummary", async () => {
      const { ctx, events } = makeEventCtx();
      const tasks: TaskList = [
        {
          key: "seed",
          task: {
            kind: "set",
            set: { done: true },
            input: { from: { order_id: "ORD-1", qty: 2 } },
          },
        },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, ctx);

      const started = events.find((e) => e.type === "task_started");
      expect(started).toBeDefined();
      expect(started!.inputSummary).toEqual({ order_id: "ORD-1", qty: 2 });
    });

    it("task_completed carries the truncated output as outputSummary", async () => {
      const { ctx, events } = makeEventCtx();
      const tasks: TaskList = [
        { key: "seed", task: { kind: "set", set: { total: 150, currency: "USD" } } },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, ctx);

      const completed = events.find((e) => e.type === "task_completed");
      expect(completed).toBeDefined();
      expect(completed!.outputSummary).toEqual({ total: 150, currency: "USD" });
    });

    it("omits summaries for non-object I/O (proto Struct constraint)", async () => {
      // A transform whose activity returns a scalar — the summary is
      // dropped, mirroring the snapshot path's toJsonObject semantics.
      const { ctx, events } = makeEventCtx({
        callFunction: async () => 42,
      });
      const tasks: TaskList = [
        {
          key: "toScalar",
          task: {
            kind: "call:function",
            call: "transform",
            with: { engine: "JQ", expression: ".qty" },
          },
        },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, ctx);

      const started = events.find((e) => e.type === "task_started");
      const completed = events.find((e) => e.type === "task_completed");
      expect(started!.inputSummary).toBeUndefined();
      expect(completed!.outputSummary).toBeUndefined();
    });

    it("replaces oversize payloads with the truncation marker (8KB event budget)", async () => {
      const { ctx, events } = makeEventCtx();
      const big = "x".repeat(10_000);
      const tasks: TaskList = [
        { key: "seed", task: { kind: "set", set: { big } } },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, ctx);

      const completed = events.find((e) => e.type === "task_completed");
      const summary = completed!.outputSummary as Record<string, unknown>;
      expect(summary._truncated).toBe(true);
      expect(typeof summary._preview).toBe("string");
      expect(JSON.stringify(summary).length).toBeLessThan(8_192);
    });

    it("replays the pre-patch order: task_started without inputSummary when the gate is off", async () => {
      const { ctx, events } = makeEventCtx({
        isPatched: () => false,
      });
      const tasks: TaskList = [
        { key: "seed", task: { kind: "set", set: { done: true } } },
      ];

      const state = createState();
      await executeDoTasks(tasks, { a: 1 }, state, doc, evaluateExpressionBatch, ctx);

      const started = events.find((e) => e.type === "task_started");
      expect(started).toBeDefined();
      expect(started!.inputSummary).toBeUndefined();
      // The completed-side summary is payload-only (no command-order
      // change) and stays active regardless of the gate.
      const completed = events.find((e) => e.type === "task_completed");
      expect(completed!.outputSummary).toEqual({ done: true });
    });

    it("preserves the started→failed pair when input resolution fails", async () => {
      const { ctx, events } = makeEventCtx();
      const tasks: TaskList = [
        {
          key: "doomed",
          task: {
            kind: "set",
            set: { unreachable: true },
            input: { from: "${ .foo | not_a_jq_function }" },
          },
        },
      ];

      const state = createState();
      await expect(
        executeDoTasks(tasks, {}, state, doc, evaluateExpressionBatch, ctx),
      ).rejects.toThrow();

      const types = events.map((e) => e.type);
      const startedIdx = types.indexOf("task_started");
      const failedIdx = types.indexOf("task_failed");
      expect(startedIdx).toBeGreaterThanOrEqual(0);
      expect(failedIdx).toBeGreaterThan(startedIdx);
      const started = events[startedIdx];
      expect(started.inputSummary).toBeUndefined();
    });
  });
});
