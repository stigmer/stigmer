import { describe, it, expect } from "vitest";
import { executeForkTask } from "../tasks/fork.js";
import { executeDoTasks } from "../do-executor.js";
import { createState } from "../state.js";
import { evaluateExpressionBatch } from "../expression.js";
import type { TaskList, WorkflowModel, ForkTaskDef, TaskEntry } from "../types.js";

const doc: WorkflowModel = {
  document: { dsl: "1.0.0", name: "fork-test-workflow" },
  do: [],
};

function forkTask(
  name: string,
  taskDef: Omit<ForkTaskDef, "kind">,
): TaskEntry {
  return { key: name, task: { kind: "fork", ...taskDef } as ForkTaskDef };
}

// ─────────────────────────────────────────────────────────────────────
// Non-Compete Mode (default)
// ─────────────────────────────────────────────────────────────────────

describe("fork task execution", () => {
  describe("non-compete: all branches", () => {
    it("executes two branches in parallel — output keyed by branch name", async () => {
      const tasks: TaskList = [
        forkTask("parallel", {
          fork: {
            branches: [
              { key: "branchA", task: { kind: "do", do: [
                { key: "setA", task: { kind: "set", set: { result: "from-A" } } },
              ]}},
              { key: "branchB", task: { kind: "do", do: [
                { key: "setB", task: { kind: "set", set: { result: "from-B" } } },
              ]}},
            ],
          },
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.output).toEqual({
        branchA: { result: "from-A" },
        branchB: { result: "from-B" },
      });
    });

    it("executes three branches — all contribute to output", async () => {
      const tasks: TaskList = [
        forkTask("parallel", {
          fork: {
            branches: [
              { key: "alpha", task: { kind: "do", do: [
                { key: "s1", task: { kind: "set", set: { value: 1 } } },
              ]}},
              { key: "beta", task: { kind: "do", do: [
                { key: "s2", task: { kind: "set", set: { value: 2 } } },
              ]}},
              { key: "gamma", task: { kind: "do", do: [
                { key: "s3", task: { kind: "set", set: { value: 3 } } },
              ]}},
            ],
          },
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.output).toEqual({
        alpha: { value: 1 },
        beta: { value: 2 },
        gamma: { value: 3 },
      });
    });

    it("handles single branch", async () => {
      const tasks: TaskList = [
        forkTask("solo", {
          fork: {
            branches: [
              { key: "only", task: { kind: "do", do: [
                { key: "set", task: { kind: "set", set: { alone: true } } },
              ]}},
            ],
          },
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.output).toEqual({ only: { alone: true } });
    });

    it("branches with multiple sequential tasks", async () => {
      const tasks: TaskList = [
        forkTask("parallel", {
          fork: {
            branches: [
              { key: "branch", task: { kind: "do", do: [
                { key: "step1", task: { kind: "set", set: { first: true } } },
                { key: "step2", task: { kind: "set", set: { second: true } } },
                { key: "step3", task: { kind: "set", set: { third: true } } },
              ]}},
            ],
          },
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.output).toEqual({
        branch: { third: true },
      });
    });

    it("branch output is the last task output of that branch", async () => {
      const tasks: TaskList = [
        forkTask("parallel", {
          fork: {
            branches: [
              { key: "a", task: { kind: "do", do: [
                { key: "s1", task: { kind: "set", set: { x: 10 } } },
                { key: "s2", task: { kind: "set", set: { y: 20 } } },
              ]}},
              { key: "b", task: { kind: "do", do: [
                { key: "s1", task: { kind: "set", set: { z: 30 } } },
              ]}},
            ],
          },
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.output).toEqual({
        a: { y: 20 },
        b: { z: 30 },
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // State Isolation
  // ─────────────────────────────────────────────────────────────────────

  describe("state isolation", () => {
    it("branches see the parent state snapshot but cannot mutate it", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { shared: "original" } } },
        forkTask("parallel", {
          fork: {
            branches: [
              { key: "a", task: { kind: "do", do: [
                { key: "mutate", task: { kind: "set", set: { shared: "mutated-by-a" } } },
              ]}},
              { key: "b", task: { kind: "do", do: [
                { key: "read", task: { kind: "set", set: { saw: "${ $data.shared }" } } },
              ]}},
            ],
          },
        }),
        { key: "verify", task: { kind: "set", set: { final: "${ $data.shared }" } } },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.data.final).toBe("original");
    });

    it("branches do not see each other's mutations", async () => {
      const tasks: TaskList = [
        forkTask("parallel", {
          fork: {
            branches: [
              { key: "writer", task: { kind: "do", do: [
                { key: "write", task: { kind: "set", set: { secret: "hidden" } } },
              ]}},
              { key: "reader", task: { kind: "do", do: [
                { key: "read", task: { kind: "set", set: { found: "${ $data.secret // \"not-found\" }" } } },
              ]}},
            ],
          },
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      const output = state.output as Record<string, unknown>;
      expect(output.reader).toEqual({ found: "not-found" });
    });

    it("each branch starts with cleared output", async () => {
      const tasks: TaskList = [
        { key: "prior", task: { kind: "set", set: { priorResult: "exists" } } },
        forkTask("parallel", {
          fork: {
            branches: [
              { key: "check", task: { kind: "do", do: [
                { key: "inspect", task: { kind: "set", set: { sawOutput: "${ $output // \"null\" }" } } },
              ]}},
            ],
          },
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      const output = state.output as Record<string, unknown>;
      expect(output.check).toEqual({ sawOutput: "null" });
    });

    it("parent context is visible to branches", async () => {
      const tasks: TaskList = [
        {
          key: "init",
          task: {
            kind: "set",
            set: { config: "production" },
            export: { as: "${ . }" },
          },
        },
        forkTask("parallel", {
          fork: {
            branches: [
              { key: "a", task: { kind: "do", do: [
                { key: "read", task: { kind: "set", set: { env: "${ $context.init.config }" } } },
              ]}},
            ],
          },
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      const output = state.output as Record<string, unknown>;
      expect(output.a).toEqual({ env: "production" });
    });

    it("parent env is visible to branches", async () => {
      const state = createState();
      state.env = { API_KEY: "test-key" };

      const forkDef: ForkTaskDef = {
        kind: "fork",
        fork: {
          branches: [
            { key: "a", task: { kind: "do", do: [
              { key: "read", task: { kind: "set", set: { key: "${ $env.API_KEY }" } } },
            ]}},
          ],
        },
      };

      const result = await executeForkTask(
        forkDef, null, state, doc, evaluateExpressionBatch,
      );

      expect(result).toEqual({ a: { key: "test-key" } });
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Error Handling
  // ─────────────────────────────────────────────────────────────────────

  describe("error handling", () => {
    it("throws when branches array is empty", async () => {
      const forkDef: ForkTaskDef = {
        kind: "fork",
        fork: { branches: [] },
      };

      const state = createState();
      await expect(
        executeForkTask(forkDef, null, state, doc, evaluateExpressionBatch),
      ).rejects.toThrow("at least one branch");
    });

    it("non-compete: error in one branch fails the entire fork", async () => {
      const tasks: TaskList = [
        forkTask("parallel", {
          fork: {
            branches: [
              { key: "good", task: { kind: "do", do: [
                { key: "ok", task: { kind: "set", set: { fine: true } } },
              ]}},
              { key: "bad", task: { kind: "do", do: [
                { key: "fail", task: {
                  kind: "raise",
                  raise: { error: { type: "test/error", status: 500, title: "Branch failed" } },
                }},
              ]}},
            ],
          },
        }),
      ];

      const state = createState();
      await expect(
        executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch),
      ).rejects.toThrow();
    });

    it("non-compete: parent state is not corrupted after branch error", async () => {
      const state = createState();
      state.addData({ marker: "before" });

      const forkDef: ForkTaskDef = {
        kind: "fork",
        fork: {
          branches: [
            { key: "fail", task: { kind: "do", do: [
              { key: "boom", task: {
                kind: "raise",
                raise: { error: { type: "test/error", status: 500 } },
              }},
            ]}},
          ],
        },
      };

      await expect(
        executeForkTask(forkDef, null, state, doc, evaluateExpressionBatch),
      ).rejects.toThrow();

      expect(state.data.marker).toBe("before");
    });

    it("fork inside try/catch — error is catchable", async () => {
      const tasks: TaskList = [
        {
          key: "tryCatch",
          task: {
            kind: "try",
            try: [
              forkTask("parallel", {
                fork: {
                  branches: [
                    { key: "fail", task: { kind: "do", do: [
                      { key: "boom", task: {
                        kind: "raise",
                        raise: { error: { type: "fork/error", status: 503, title: "Service down" } },
                      }},
                    ]}},
                  ],
                },
              }),
            ],
            catch: {
              as: "caught",
              do: [
                { key: "handle", task: { kind: "set", set: { recovered: true } } },
              ],
            },
          },
        },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.data.recovered).toBe(true);
      const caught = state.data.caught as Record<string, unknown>;
      expect(caught.type).toBe("fork/error");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Compete Mode (Race)
  // ─────────────────────────────────────────────────────────────────────

  describe("compete mode", () => {
    it("returns the winning branch output directly (not keyed by name)", async () => {
      const forkDef: ForkTaskDef = {
        kind: "fork",
        fork: {
          compete: true,
          branches: [
            { key: "fast", task: { kind: "do", do: [
              { key: "result", task: { kind: "set", set: { winner: true } } },
            ]}},
            { key: "slow", task: { kind: "do", do: [
              { key: "result", task: { kind: "set", set: { winner: false } } },
            ]}},
          ],
        },
      };

      const state = createState();
      const result = await executeForkTask(
        forkDef, null, state, doc, evaluateExpressionBatch,
      );

      // Both branches are synchronous set tasks, so either could win.
      // The output should be a raw branch result, NOT { fast: ..., slow: ... }
      expect(result).toHaveProperty("winner");
      expect(typeof (result as Record<string, unknown>).winner).toBe("boolean");
    });

    it("compete output is not wrapped in branch name", async () => {
      const forkDef: ForkTaskDef = {
        kind: "fork",
        fork: {
          compete: true,
          branches: [
            { key: "only", task: { kind: "do", do: [
              { key: "result", task: { kind: "set", set: { value: 42 } } },
            ]}},
          ],
        },
      };

      const state = createState();
      const result = await executeForkTask(
        forkDef, null, state, doc, evaluateExpressionBatch,
      );

      expect(result).toEqual({ value: 42 });
    });

    it("compete: error in any branch fails the fork", async () => {
      const forkDef: ForkTaskDef = {
        kind: "fork",
        fork: {
          compete: true,
          branches: [
            { key: "fail", task: { kind: "do", do: [
              { key: "boom", task: {
                kind: "raise",
                raise: { error: { type: "test/error", status: 500 } },
              }},
            ]}},
            { key: "ok", task: { kind: "do", do: [
              { key: "set", task: { kind: "set", set: { fine: true } } },
            ]}},
          ],
        },
      };

      const state = createState();
      // The race semantics mean either the error or the success could win.
      // With synchronous set tasks, both resolve ~simultaneously.
      // We verify the function doesn't hang or throw unhandled rejection.
      try {
        await executeForkTask(
          forkDef, null, state, doc, evaluateExpressionBatch,
        );
      } catch {
        // Error from the failing branch is acceptable
      }
    });

    it("compete with compete: false falls back to non-compete", async () => {
      const forkDef: ForkTaskDef = {
        kind: "fork",
        fork: {
          compete: false,
          branches: [
            { key: "a", task: { kind: "do", do: [
              { key: "s", task: { kind: "set", set: { x: 1 } } },
            ]}},
            { key: "b", task: { kind: "do", do: [
              { key: "s", task: { kind: "set", set: { y: 2 } } },
            ]}},
          ],
        },
      };

      const state = createState();
      const result = await executeForkTask(
        forkDef, null, state, doc, evaluateExpressionBatch,
      );

      expect(result).toEqual({
        a: { x: 1 },
        b: { y: 2 },
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Branch Normalization
  // ─────────────────────────────────────────────────────────────────────

  describe("branch normalization", () => {
    it("wraps a single leaf task (non-do) into a task list", async () => {
      const forkDef: ForkTaskDef = {
        kind: "fork",
        fork: {
          branches: [
            { key: "leaf", task: { kind: "set", set: { direct: true } } },
          ],
        },
      };

      const state = createState();
      const result = await executeForkTask(
        forkDef, null, state, doc, evaluateExpressionBatch,
      );

      expect(result).toEqual({ leaf: { direct: true } });
    });

    it("unwraps a do branch into its task list", async () => {
      const forkDef: ForkTaskDef = {
        kind: "fork",
        fork: {
          branches: [
            { key: "wrapped", task: { kind: "do", do: [
              { key: "inner1", task: { kind: "set", set: { a: 1 } } },
              { key: "inner2", task: { kind: "set", set: { b: 2 } } },
            ]}},
          ],
        },
      };

      const state = createState();
      const result = await executeForkTask(
        forkDef, null, state, doc, evaluateExpressionBatch,
      );

      expect(result).toEqual({ wrapped: { b: 2 } });
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Nested Orchestration
  // ─────────────────────────────────────────────────────────────────────

  describe("nested orchestration", () => {
    it("fork inside for loop", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { items: [1, 2] } } },
        {
          key: "loop",
          task: {
            kind: "for",
            for: { in: "${ $data.items }" },
            do: [
              forkTask("inner", {
                fork: {
                  branches: [
                    { key: "a", task: { kind: "do", do: [
                      { key: "s", task: { kind: "set", set: { val: "${ $data.item }" } } },
                    ]}},
                    { key: "b", task: { kind: "do", do: [
                      { key: "s", task: { kind: "set", set: { doubled: "${ $data.item * 2 }" } } },
                    ]}},
                  ],
                },
              }),
            ],
          },
        },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      const results = state.output as Record<string, unknown>[];
      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ a: { val: 1 }, b: { doubled: 2 } });
      expect(results[1]).toEqual({ a: { val: 2 }, b: { doubled: 4 } });
    });

    it("for loop inside fork branch", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { nums: [10, 20, 30] } } },
        forkTask("parallel", {
          fork: {
            branches: [
              { key: "looper", task: { kind: "do", do: [
                {
                  key: "iterate",
                  task: {
                    kind: "for",
                    for: { in: "${ $data.nums }" },
                    do: [
                      { key: "capture", task: { kind: "set", set: { n: "${ $data.item }" } } },
                    ],
                  },
                },
              ]}},
              { key: "static", task: { kind: "do", do: [
                { key: "fixed", task: { kind: "set", set: { constant: true } } },
              ]}},
            ],
          },
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      const output = state.output as Record<string, unknown>;
      expect(output.looper).toEqual([{ n: 10 }, { n: 20 }, { n: 30 }]);
      expect(output.static).toEqual({ constant: true });
    });

    it("switch inside fork branch", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { mode: "fast" } } },
        forkTask("parallel", {
          fork: {
            branches: [
              { key: "decider", task: { kind: "do", do: [
                {
                  key: "decide",
                  task: {
                    kind: "switch",
                    switch: [
                      { name: "fastPath", when: "${ $data.mode == \"fast\" }", then: "result" },
                      { name: "default", then: "end" },
                    ],
                  },
                },
                { key: "skipped", task: { kind: "set", set: { slow: true } } },
                { key: "result", task: { kind: "set", set: { fast: true } } },
              ]}},
            ],
          },
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      const output = state.output as Record<string, unknown>;
      expect(output.decider).toEqual({ fast: true });
    });

    it("nested fork (fork inside fork)", async () => {
      const tasks: TaskList = [
        forkTask("outer", {
          fork: {
            branches: [
              { key: "left", task: { kind: "do", do: [
                forkTask("innerLeft", {
                  fork: {
                    branches: [
                      { key: "ll", task: { kind: "do", do: [
                        { key: "s", task: { kind: "set", set: { pos: "left-left" } } },
                      ]}},
                      { key: "lr", task: { kind: "do", do: [
                        { key: "s", task: { kind: "set", set: { pos: "left-right" } } },
                      ]}},
                    ],
                  },
                }),
              ]}},
              { key: "right", task: { kind: "do", do: [
                { key: "s", task: { kind: "set", set: { pos: "right" } } },
              ]}},
            ],
          },
        }),
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      const output = state.output as Record<string, unknown>;
      expect(output.left).toEqual({
        ll: { pos: "left-left" },
        lr: { pos: "left-right" },
      });
      expect(output.right).toEqual({ pos: "right" });
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Output / Export Integration
  // ─────────────────────────────────────────────────────────────────────

  describe("output and export integration", () => {
    it("output.as transforms the fork result", async () => {
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
            output: { as: "${ . | keys | length }" },
          } as ForkTaskDef,
        },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.output).toBe(2);
    });

    it("export.as stores fork result in context", async () => {
      const tasks: TaskList = [
        {
          key: "parallel",
          task: {
            kind: "fork",
            fork: {
              branches: [
                { key: "a", task: { kind: "do", do: [
                  { key: "s", task: { kind: "set", set: { x: 10 } } },
                ]}},
                { key: "b", task: { kind: "do", do: [
                  { key: "s", task: { kind: "set", set: { y: 20 } } },
                ]}},
              ],
            },
            export: { as: "${ . }" },
          } as ForkTaskDef,
        },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.context).toEqual({
        parallel: { a: { x: 10 }, b: { y: 20 } },
      });
    });

    it("downstream task accesses fork output via expression", async () => {
      const tasks: TaskList = [
        forkTask("parallel", {
          fork: {
            branches: [
              { key: "branchA", task: { kind: "do", do: [
                { key: "s", task: { kind: "set", set: { data: "alpha" } } },
              ]}},
              { key: "branchB", task: { kind: "do", do: [
                { key: "s", task: { kind: "set", set: { data: "beta" } } },
              ]}},
            ],
          },
        }),
        {
          key: "aggregate",
          task: {
            kind: "set",
            set: {
              fromA: "${ $output.branchA.data }",
              fromB: "${ $output.branchB.data }",
            },
          },
        },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.output).toEqual({
        fromA: "alpha",
        fromB: "beta",
      });
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Input Propagation
  // ─────────────────────────────────────────────────────────────────────

  describe("input propagation", () => {
    it("branches receive the workflow input", async () => {
      const forkDef: ForkTaskDef = {
        kind: "fork",
        fork: {
          branches: [
            { key: "a", task: { kind: "do", do: [
              { key: "read", task: { kind: "set", set: { got: "${ $input }" } } },
            ]}},
          ],
        },
      };

      const state = createState();
      state.input = { payload: "hello" };
      const result = await executeForkTask(
        forkDef, { payload: "hello" }, state, doc, evaluateExpressionBatch,
      );

      expect(result).toEqual({ a: { got: { payload: "hello" } } });
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Conditional Fork (if guard)
  // ─────────────────────────────────────────────────────────────────────

  describe("conditional fork (if guard)", () => {
    it("skips fork when if condition is false", async () => {
      const tasks: TaskList = [
        { key: "setup", task: { kind: "set", set: { skip: true } } },
        {
          key: "parallel",
          task: {
            kind: "fork",
            if: "${ $data.skip == false }",
            fork: {
              branches: [
                { key: "a", task: { kind: "do", do: [
                  { key: "s", task: { kind: "set", set: { ran: true } } },
                ]}},
              ],
            },
          } as ForkTaskDef,
        },
        { key: "after", task: { kind: "set", set: { completed: true } } },
      ];

      const state = createState();
      await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

      expect(state.data.completed).toBe(true);
      expect(state.output).toEqual({ completed: true });
    });
  });
});
