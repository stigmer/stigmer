import { describe, it, expect, vi } from "vitest";
import { executeDoTasks } from "../do-executor.js";
import { createState } from "../state.js";
import { evaluateExpressionBatch } from "../expression.js";
import type { TaskList, WorkflowModel, TaskExecutionContext } from "../types.js";

const doc: WorkflowModel = {
  document: { dsl: "1.0.0", name: "pause-resume-test" },
  do: [],
};

function buildCtxWithPause(checkPause: () => Promise<void>): TaskExecutionContext {
  return {
    evaluateExpressions: evaluateExpressionBatch,
    doc,
    checkPause,
    sleep: vi.fn(async () => {}),
    listen: vi.fn(async () => ({})),
    runCommand: vi.fn(async () => ({})),
    runWorkflow: vi.fn(async () => ({})),
    awaitHumanInput: vi.fn(async () => ({ outcome: "approved" })),
    callHttp: vi.fn(async () => ({})),
    callGrpc: vi.fn(async () => ({})),
    callFunction: vi.fn(async () => ({})),
    callAgent: vi.fn(async () => ({ structured: {} })),
  };
}

describe("pause/resume via checkPause", () => {
  it("checkPause is called between each task", async () => {
    const checkPause = vi.fn(async () => {});

    const tasks: TaskList = [
      { key: "a", task: { kind: "set", set: { a: 1 } } },
      { key: "b", task: { kind: "set", set: { b: 2 } } },
      { key: "c", task: { kind: "set", set: { c: 3 } } },
    ];

    const state = createState();
    const ctx = buildCtxWithPause(checkPause);
    await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, ctx);

    expect(checkPause).toHaveBeenCalledTimes(3);
    expect(state.data).toMatchObject({ a: 1, b: 2, c: 3 });
  });

  it("blocks engine when checkPause does not resolve immediately", async () => {
    const executionOrder: string[] = [];
    let resolveBlock: (() => void) | null = null;
    let callCount = 0;

    const checkPause = vi.fn(async () => {
      callCount++;
      executionOrder.push(`checkPause-${callCount}`);
      if (callCount === 2) {
        await new Promise<void>((resolve) => {
          resolveBlock = resolve;
        });
        executionOrder.push("resumed");
      }
    });

    const tasks: TaskList = [
      { key: "a", task: { kind: "set", set: { a: 1 } } },
      { key: "b", task: { kind: "set", set: { b: 2 } } },
      { key: "c", task: { kind: "set", set: { c: 3 } } },
    ];

    const state = createState();
    const ctx = buildCtxWithPause(checkPause);

    const executionPromise = executeDoTasks(
      tasks, null, state, doc, evaluateExpressionBatch, ctx,
    );

    await vi.waitFor(() => {
      expect(callCount).toBe(2);
    });

    expect(state.data.a).toBe(1);
    expect(state.data.b).toBeUndefined();
    expect(state.data.c).toBeUndefined();

    resolveBlock!();
    await executionPromise;

    expect(state.data).toMatchObject({ a: 1, b: 2, c: 3 });
    expect(executionOrder).toEqual([
      "checkPause-1",
      "checkPause-2",
      "resumed",
      "checkPause-3",
    ]);
  });

  it("without checkPause, engine runs without pausing (backward compat)", async () => {
    const tasks: TaskList = [
      { key: "a", task: { kind: "set", set: { a: 1 } } },
      { key: "b", task: { kind: "set", set: { b: 2 } } },
    ];

    const state = createState();
    await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch);

    expect(state.data).toMatchObject({ a: 1, b: 2 });
  });

  it("checkPause is called between for-each iterations", async () => {
    const checkPause = vi.fn(async () => {});

    const tasks: TaskList = [
      {
        key: "loop",
        task: {
          kind: "for",
          for: { each: "item", in: "${ [1, 2, 3] }" },
          do: [
            { key: "body", task: { kind: "set", set: { ran: true } } },
          ],
        },
      },
    ];

    const state = createState();
    const ctx = buildCtxWithPause(checkPause);
    await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, ctx);

    // 1 call at the top-level loop task + 3 for iterations * 1 body task
    // = 1 (top-level) + 3 (for iterations) + 3 (body inside each iteration via nested executeDoTasks)
    // for.ts calls checkPause between iterations (3 times)
    // do-executor calls checkPause before each task (1 for the for-task + 1 per body task per iteration = 1 + 3)
    // Total: 1 + 3 + 3 = 7
    expect(checkPause.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("checkPause is called between try-catch retry attempts", async () => {
    const checkPause = vi.fn(async () => {});
    let callCount = 0;

    const tasks: TaskList = [
      {
        key: "retry-task",
        task: {
          kind: "try",
          try: [
            {
              key: "failing",
              task: {
                kind: "raise",
                raise: {
                  error: { type: "test-error", status: 500, title: "Test" },
                },
              },
            },
          ],
          catch: {
            as: "error",
            retry: {
              limit: { attempt: { count: 3 } },
              delay: { milliseconds: 0 },
            },
          },
        },
      },
    ];

    const state = createState();
    const ctx = buildCtxWithPause(checkPause);
    await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, ctx);

    // checkPause should be called between retry attempts
    expect(checkPause.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("checkPause throwing propagates to caller", async () => {
    const error = new Error("CancelledFailure simulation");
    const checkPause = vi.fn(async () => {
      throw error;
    });

    const tasks: TaskList = [
      { key: "a", task: { kind: "set", set: { a: 1 } } },
    ];

    const state = createState();
    const ctx = buildCtxWithPause(checkPause);

    await expect(
      executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, ctx),
    ).rejects.toThrow("CancelledFailure simulation");
  });

  it("checkPause not called for skipped tasks (if-guard false)", async () => {
    const checkPause = vi.fn(async () => {});

    const tasks: TaskList = [
      { key: "a", task: { kind: "set", set: { a: 1 } } },
      { key: "b", task: { kind: "set", set: { b: 2 }, if: "${ false }" } },
      { key: "c", task: { kind: "set", set: { c: 3 } } },
    ];

    const state = createState();
    const ctx = buildCtxWithPause(checkPause);
    await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, ctx);

    // checkPause is called 3 times (before each task in the loop),
    // even for skipped tasks — the check happens before the if-guard
    expect(checkPause).toHaveBeenCalledTimes(3);
    expect(state.data.b).toBeUndefined();
  });

  it("pause during nested do block pauses at inner task boundary", async () => {
    let callCount = 0;
    let resolveBlock: (() => void) | null = null;

    // checkPause is called BEFORE each task. Call order:
    //   1: before outer-1 → outer-1 runs
    //   2: before nested-do → nested executeDoTasks starts
    //   3: before inner-1 → inner-1 runs
    //   4: before inner-2 → BLOCK (inner-1 done, inner-2 not started)
    const checkPause = vi.fn(async () => {
      callCount++;
      if (callCount === 4) {
        await new Promise<void>((resolve) => {
          resolveBlock = resolve;
        });
      }
    });

    const tasks: TaskList = [
      { key: "outer-1", task: { kind: "set", set: { outer1: true } } },
      {
        key: "nested",
        task: {
          kind: "do",
          do: [
            { key: "inner-1", task: { kind: "set", set: { inner1: true } } },
            { key: "inner-2", task: { kind: "set", set: { inner2: true } } },
          ],
        },
      },
      { key: "outer-2", task: { kind: "set", set: { outer2: true } } },
    ];

    const state = createState();
    const ctx = buildCtxWithPause(checkPause);

    const promise = executeDoTasks(
      tasks, null, state, doc, evaluateExpressionBatch, ctx,
    );

    await vi.waitFor(() => {
      expect(callCount).toBe(4);
    });

    expect(state.data.outer1).toBe(true);
    expect(state.data.inner1).toBe(true);
    expect(state.data.inner2).toBeUndefined();

    resolveBlock!();
    await promise;

    expect(state.data).toMatchObject({
      outer1: true, inner1: true, inner2: true, outer2: true,
    });
  });
});
